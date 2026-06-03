const PRELOAD_BASE_SCORE = 1;
const TRANSITION_FREQUENCY_REFERENCE_SET = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const TRANSITION_FREQUENCY_REFERENCE_LOGS = TRANSITION_FREQUENCY_REFERENCE_SET.map((value) =>
  Math.log(value)
);
const TRANSITION_FREQUENCY_LOG_MEAN =
  TRANSITION_FREQUENCY_REFERENCE_LOGS.reduce((sum, value) => sum + value, 0) /
  TRANSITION_FREQUENCY_REFERENCE_LOGS.length;
const TRANSITION_FREQUENCY_LOG_SD = Math.sqrt(
  TRANSITION_FREQUENCY_REFERENCE_LOGS.reduce(
    (sum, value) => sum + (value - TRANSITION_FREQUENCY_LOG_MEAN) ** 2,
    0
  ) / TRANSITION_FREQUENCY_REFERENCE_LOGS.length
);
const TRANSITION_FREQUENCY_SIGMOID_SCALE = 2;
const AI_INTEREST_KEYWORD_CACHE_TTL_MS = 15_000;
const MAX_OPEN_CONTEXT_PAGES = 8;
const aiInterestKeywordCache = new Map();

function buildPreloadCandidateBaseScore() {
  return PRELOAD_BASE_SCORE;
}

function buildFrequencyLikeScoreMultiplier(signal, options = {}) {
  const normalizedSignal = Number(signal);
  const sanitizedSignal = Number.isFinite(normalizedSignal)
    ? Math.max(
        0,
        options?.truncate === true ? Math.trunc(normalizedSignal) : normalizedSignal
      )
    : 0;

  if (sanitizedSignal <= 0) {
    return 1;
  }

  const normalizedLogDistance =
    (Math.log(sanitizedSignal) - TRANSITION_FREQUENCY_LOG_MEAN) /
    TRANSITION_FREQUENCY_LOG_SD;

  return 1 + TRANSITION_FREQUENCY_SIGMOID_SCALE / (1 + Math.exp(-normalizedLogDistance));
}

function buildSchedulerLinkValueMultiplier(signal) {
  const normalizedSignal = Number(signal);
  const sanitizedSignal = Number.isFinite(normalizedSignal)
    ? Math.max(0, normalizedSignal)
    : 0;

  return 1 + Math.log1p(sanitizedSignal);
}

function buildTransitionFrequencyScoreMultiplier(transitionCount) {
  return buildFrequencyLikeScoreMultiplier(transitionCount, { truncate: true });
}

function buildPreloadCandidateScoreMultipliers({
  isSameSite,
  isSameOrigin,
  outboundPageTransitionCount,
  intraSitePageTransitionCount,
}) {
  const shouldUseIntraSiteCount =
    typeof isSameSite === "boolean" ? isSameSite : isSameOrigin === true;
  const effectivePageTransitionCount = shouldUseIntraSiteCount
    ? intraSitePageTransitionCount
    : outboundPageTransitionCount;

  return [buildTransitionFrequencyScoreMultiplier(effectivePageTransitionCount)];
}

async function scorePreloadCandidatePool(candidatePool, context = {}) {
  const scorableCandidatePool = (Array.isArray(candidatePool) ? candidatePool : []).filter(
    (candidate) => !candidate?.bookmarkPreload
  );
  const candidatePoolWithAi = await appendAiKeywordScoreMultipliers(
    scorableCandidatePool,
    context
  );
  const scoreInputs = candidatePoolWithAi.map((candidate) => ({
    baseScore: candidate.baseScore,
    multipliers: candidate.scoreMultipliers,
  }));
  const scoreBreakdowns = await scorePreloadCandidatesBatch(scoreInputs);

  return candidatePoolWithAi.map((candidate, index) =>
    applyPreloadCandidateScore(candidate, scoreBreakdowns[index] ?? null)
  );
}

function comparePreloadCandidateFrequency(left, right) {
  if (right.transitionCount !== left.transitionCount) {
    return right.transitionCount - left.transitionCount;
  }

  return comparePreloadCandidatePriority(left, right);
}

function comparePreloadCandidatePriority(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.visibilityScore !== left.visibilityScore) {
    return right.visibilityScore - left.visibilityScore;
  }

  return left.linkIndex - right.linkIndex;
}

function applyPreloadCandidateScore(candidate, breakdown) {
  const normalizedScore = Number(breakdown?.normalizedScore);

  return {
    ...candidate,
    scoreBreakdown: breakdown ?? null,
    score: Number.isFinite(normalizedScore) ? normalizedScore : candidate.baseScore,
  };
}

async function appendAiKeywordScoreMultipliers(candidatePool, context) {
  if (!Array.isArray(candidatePool) || candidatePool.length === 0) {
    return [];
  }

  const aiKeywordMultipliersByUrl = await buildAiKeywordMultipliersByUrl(candidatePool, context);

  return candidatePool.map((candidate) => {
    const aiKeywordMatch = aiKeywordMultipliersByUrl.get(candidate.url) ?? null;

    if (!aiKeywordMatch || aiKeywordMatch.multiplier <= 1) {
      return candidate;
    }

    return {
      ...candidate,
      aiKeywordMatch,
      scoreMultipliers: [...candidate.scoreMultipliers, aiKeywordMatch.multiplier],
    };
  });
}

async function buildAiKeywordMultipliersByUrl(candidatePool, context) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;

  if (!aiKeywordTools) {
    recordAiPredictionDiagnostic("prediction.ai.page-match.skip", {
      reason: "keyword-tools-unavailable",
      candidateCount: Array.isArray(candidatePool) ? candidatePool.length : 0,
    });
    return new Map();
  }
  const aiContext = await getAiInterestKeywordsForPreloading(context);
  const graph = context?.graph ?? null;

  if (!graph || !Array.isArray(aiContext?.interestKeywords) || aiContext.interestKeywords.length === 0) {
    recordAiPredictionDiagnostic("prediction.ai.page-match.skip", {
      reason: !graph ? "graph-unavailable" : "interest-keywords-empty",
      candidateCount: Array.isArray(candidatePool) ? candidatePool.length : 0,
      interestKeywordCount: Array.isArray(aiContext?.interestKeywords)
        ? aiContext.interestKeywords.length
        : 0,
    });
    return new Map();
  }
  const targetPageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
    type: "get-page-keywords-batch",
    pageUrls: candidatePool.map((candidate) => candidate.targetPageUrl).filter(Boolean),
  });


  const multipliersByUrl = new Map();
  let targetKeywordEntryCount = 0;
  let matchedCandidateCount = 0;
  let maxMultiplier = 1;

  for (const candidate of candidatePool) {
    const keywordEntryLookupUrl = normalizePageUrlForIndex(
      candidate.targetPageUrl || candidate.url || ""
    );
    const targetPageKeywordEntry =
      targetPageKeywordsByUrl?.[keywordEntryLookupUrl] ??
      null;
    if (targetPageKeywordEntry) {
      targetKeywordEntryCount += 1;
    }
    const aiKeywordMatch = aiKeywordTools.buildAiKeywordMatchResult({
      interestKeywords: aiContext.interestKeywords,
      candidate,
      targetPageKeywordEntry,
    });
    if (aiKeywordMatch?.multiplier > 1) {
      matchedCandidateCount += 1;
      maxMultiplier = Math.max(maxMultiplier, Number(aiKeywordMatch.multiplier) || 1);
    }
    multipliersByUrl.set(candidate.url, aiKeywordMatch);
  }

  recordAiPredictionDiagnostic("prediction.ai.page-match.result", {
    candidateCount: candidatePool.length,
    interestKeywordCount: aiContext.interestKeywords.length,
    targetKeywordEntryCount,
    matchedCandidateCount,
    maxMultiplier,
  });

  return multipliersByUrl;
}

async function getAiInterestKeywordsForPreloading(context = {}) {
  const predictionContext = resolveAiInterestPredictionContext(context);

  if (!predictionContext.ready) {
    recordAiPredictionDiagnostic("prediction.ai.interest.skip", {
      enabled: predictionContext.aiPredictionSettings.enabled === true,
      configured: predictionContext.settings?.preloading?.effectiveAiPredictionConfigured === true,
      hasProvider: typeof predictionContext.aiProvider?.invokeConfiguredAiProvider === "function",
      hasModel: Boolean(predictionContext.aiPredictionSettings.modelId),
      hasKeywordTools: Boolean(predictionContext.aiKeywordTools),
      hasGraph: Boolean(predictionContext.graph),
    });
    return buildEmptyAiInterestContext();
  }

  const { historyPagePool, recentForegroundPages, currentPage, openPages } =
    await loadAiInterestPageContext(context, predictionContext.graph);
  const interestKeywords = await getAiInterestKeywords({
    settings: predictionContext.settings,
    currentPage,
    openPages,
    historyPagePool,
    recentForegroundPages,
  });

  recordAiInterestResultDiagnostic(
    predictionContext.aiPredictionSettings,
    interestKeywords,
    openPages,
    recentForegroundPages,
    historyPagePool
  );

  return {
    interestKeywords,
    historyPagePool,
    recentForegroundPages,
    currentPage,
    openPages,
  };
}

function resolveAiInterestPredictionContext(context = {}) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const aiProvider = globalThis.ZeroLatencyAiProviders;
  const settings = context?.settings ?? null;
  const aiPredictionSettings = settings?.preloading?.aiPrediction ?? {};
  const graph = context?.graph ?? null;
  const ready =
    aiPredictionSettings.enabled === true &&
    settings?.preloading?.effectiveAiPredictionConfigured === true &&
    typeof aiProvider?.invokeConfiguredAiProvider === "function" &&
    Boolean(aiPredictionSettings.modelId) &&
    Boolean(aiKeywordTools) &&
    Boolean(graph);

  return {
    aiKeywordTools,
    aiProvider,
    settings,
    aiPredictionSettings,
    graph,
    ready,
  };
}

function buildEmptyAiInterestContext() {
  return {
    interestKeywords: [],
    historyPagePool: null,
    recentForegroundPages: [],
    currentPage: null,
    openPages: [],
  };
}

async function loadAiInterestPageContext(context, graph) {
  const [historyPagePool, recentForegroundPages] = await Promise.all([
    queryTrackingGraphFromGraph(graph, {
      type: "get-history-page-pool",
      limit: 5,
    }),
    queryTrackingGraphFromGraph(graph, {
      type: "get-recent-foreground-pages",
      limit: 8,
    }),
  ]);
  const currentPage = buildCurrentPageAiContextRecord(context);
  const openPages = await collectOpenContextPages({
    graph,
    sourceWindowId: context?.sourceWindowId,
    currentPage,
    historyPagePool,
    recentForegroundPages,
  });

  return {
    historyPagePool,
    recentForegroundPages,
    currentPage,
    openPages,
  };
}

function buildCurrentPageAiContextRecord(context) {
  return {
    pageUrl: normalizePageUrlForIndex(context?.sourceUrl || ""),
    title: typeof context?.currentPageTitle === "string" ? context.currentPageTitle : "",
    textDigest:
      typeof context?.currentPageTextDigest === "string" ? context.currentPageTextDigest : "",
    contentFingerprint:
      typeof context?.currentPageContentFingerprint === "string"
        ? context.currentPageContentFingerprint
        : "",
  };
}

function recordAiInterestResultDiagnostic(
  aiPredictionSettings,
  interestKeywords,
  openPages,
  recentForegroundPages,
  historyPagePool
) {
  recordAiPredictionDiagnostic("prediction.ai.interest.result", {
    providerId: aiPredictionSettings.providerId || "",
    modelId: aiPredictionSettings.modelId || "",
    interestKeywordCount: Array.isArray(interestKeywords) ? interestKeywords.length : 0,
    openPageCount: openPages.length,
    recentForegroundPageCount: Array.isArray(recentForegroundPages)
      ? recentForegroundPages.length
      : 0,
    historyPageCount: Array.isArray(historyPagePool?.urls) ? historyPagePool.urls.length : 0,
  });
}

async function getAiInterestKeywords({
  settings,
  currentPage,
  openPages,
  historyPagePool,
  recentForegroundPages,
}) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const aiProvider = globalThis.ZeroLatencyAiProviders;
  const aiPredictionSettings = settings?.preloading?.aiPrediction ?? {};
  const historyPageRecords = aiKeywordTools.buildHistoryPagePoolRecords(historyPagePool);
  const recentForegroundPageRecords = normalizeRecentForegroundPagePromptRecords(
    recentForegroundPages
  );
  const cacheKey = buildAiInterestKeywordCacheKey({
    aiPredictionSettings,
    currentPage,
    openPages,
    recentForegroundPageRecords,
    historyPageRecords,
  });
  const cachedEntry = aiInterestKeywordCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.promise;
  }

  const inferencePromise = invokeAiInterestKeywordInference({
    aiKeywordTools,
    aiProvider,
    settings,
    aiPredictionSettings,
    currentPage,
    openPages,
    recentForegroundPageRecords,
    historyPageRecords,
  });

  aiInterestKeywordCache.set(cacheKey, {
    expiresAt: Date.now() + AI_INTEREST_KEYWORD_CACHE_TTL_MS,
    promise: inferencePromise,
  });
  pruneAiInterestKeywordCache();
  return inferencePromise;
}

function buildAiInterestKeywordCacheKey({
  aiPredictionSettings,
  currentPage,
  openPages,
  recentForegroundPageRecords,
  historyPageRecords,
}) {
  return JSON.stringify({
    providerId: aiPredictionSettings.providerId || "",
    modelId: aiPredictionSettings.modelId || "",
    currentPageUrl: currentPage?.pageUrl || "",
    currentFingerprint: currentPage?.contentFingerprint || "",
    openPageUrls: (openPages || []).map((page) => page.pageUrl),
    recentForegroundPageUrls: recentForegroundPageRecords.map((page) => page.pageUrl),
    historyPageUrls: historyPageRecords.map((page) => page.pageUrl),
  });
}

function invokeAiInterestKeywordInference({
  aiKeywordTools,
  aiProvider,
  settings,
  aiPredictionSettings,
  currentPage,
  openPages,
  recentForegroundPageRecords,
  historyPageRecords,
}) {
  return aiProvider
    .invokeConfiguredAiProvider(
      settings,
      aiKeywordTools.buildContextKeywordPrompt({
        currentPage,
        openPages,
        recentForegroundPages: recentForegroundPageRecords,
        historyPagePool: historyPageRecords,
      }),
      { responseFormat: "json" }
    )
    .then((result) => aiKeywordTools.parseAiKeywordInferenceResponse(result?.output_text))
    .then((result) => (Array.isArray(result?.keywords) ? result.keywords : []))
    .catch((error) => {
      console.error("AI interest keyword inference failed.", error);
      recordAiPredictionDiagnostic("prediction.ai.interest.error", {
        providerId: aiPredictionSettings.providerId || "",
        modelId: aiPredictionSettings.modelId || "",
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
}

function recordAiPredictionDiagnostic(eventName, payload) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  globalThis.ZeroLatencyDiagnostics?.record?.(eventName, payload);
}

function normalizeRecentForegroundPagePromptRecords(recentForegroundPages) {
  return (Array.isArray(recentForegroundPages) ? recentForegroundPages : [])
    .map((record) => {
      const pageUrl = normalizePageUrlForIndex(record?.pageUrl || "");

      if (!pageUrl) {
        return null;
      }

      return {
        pageUrl,
        title: typeof record?.title === "string" ? record.title : "",
        textDigest: typeof record?.textDigest === "string" ? record.textDigest : "",
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

async function collectOpenContextPages({
  graph,
  sourceWindowId,
  currentPage,
  historyPagePool,
  recentForegroundPages,
}) {
  if (
    !Number.isFinite(Number(sourceWindowId)) ||
    globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "query") !== true
  ) {
    return [];
  }

  const historyPageRecords = globalThis.ZeroLatencyAiKeywords.buildHistoryPagePoolRecords(
    historyPagePool
  );
  const recentForegroundPageRecords = Array.isArray(recentForegroundPages)
    ? recentForegroundPages
    : [];
  const pageContextByUrl = new Map(
    [
      ...recentForegroundPageRecords.map((record) => [
        normalizePageUrlForIndex(record?.pageUrl || ""),
        {
          title: typeof record?.title === "string" ? record.title : "",
          textDigest: typeof record?.textDigest === "string" ? record.textDigest : "",
        },
      ]),
      ...historyPageRecords.map((record) => [
        record.pageUrl,
        {
          title: record.title,
          textDigest: record.textDigest,
        },
      ]),
    ].filter(([pageUrl]) => Boolean(pageUrl))
  );

  try {
    const tabs = await chrome.tabs.query({
      windowId: Number(sourceWindowId),
    });
    const openPages = tabs
      .map((tab) => {
        const pageUrl = normalizePageUrlForIndex(tab?.url || "");

        if (!pageUrl || !isTrackableAndAllowedUrl(pageUrl) || pageUrl === currentPage?.pageUrl) {
          return null;
        }

        const pageContextRecord = pageContextByUrl.get(pageUrl);

        return {
          pageUrl,
          title:
            typeof tab?.title === "string" && tab.title.trim()
              ? tab.title
              : pageContextRecord?.title || "",
          textDigest: pageContextRecord?.textDigest || "",
        };
      })
      .filter(Boolean)
      .slice(0, MAX_OPEN_CONTEXT_PAGES);

    if (!graph || openPages.length === 0) {
      return openPages;
    }

    const pageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
      type: "get-page-keywords-batch",
      pageUrls: openPages.map((page) => page.pageUrl),
    });

    return openPages.map((page) => {
      if (typeof page.textDigest === "string" && page.textDigest.trim()) {
        return page;
      }

      const pageKeywordEntry = pageKeywordsByUrl?.[page.pageUrl];
      const keywordDigest = buildPageKeywordTextDigest(pageKeywordEntry);

      if (!keywordDigest) {
        return page;
      }

      return {
        ...page,
        textDigest: keywordDigest,
      };
    });
  } catch (_error) {
    return [];
  }
}

function buildPageKeywordTextDigest(pageKeywordEntry) {
  if (!pageKeywordEntry) {
    return "";
  }

  const keywordTexts = Array.isArray(pageKeywordEntry.keywords)
    ? pageKeywordEntry.keywords
        .map((keyword) => (typeof keyword?.text === "string" ? keyword.text.trim() : ""))
        .filter(Boolean)
    : [];
  const pageType =
    typeof pageKeywordEntry.pageType === "string" ? pageKeywordEntry.pageType.trim() : "";

  return [pageType, ...keywordTexts].filter(Boolean).join(" ");
}

function pruneAiInterestKeywordCache() {
  const now = Date.now();

  for (const [cacheKey, cacheEntry] of aiInterestKeywordCache.entries()) {
    if (!cacheEntry || cacheEntry.expiresAt <= now) {
      aiInterestKeywordCache.delete(cacheKey);
    }
  }
}
