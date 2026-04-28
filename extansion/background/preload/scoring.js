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

function buildTransitionFrequencyScoreMultiplier(transitionCount) {
  const sanitizedTransitionCount = Number.isFinite(Number(transitionCount))
    ? Math.max(0, Math.trunc(Number(transitionCount)))
    : 0;

  if (sanitizedTransitionCount <= 0) {
    return 1;
  }

  const normalizedLogDistance =
    (Math.log(sanitizedTransitionCount) - TRANSITION_FREQUENCY_LOG_MEAN) /
    TRANSITION_FREQUENCY_LOG_SD;

  return 1 + TRANSITION_FREQUENCY_SIGMOID_SCALE / (1 + Math.exp(-normalizedLogDistance));
}

function buildPreloadCandidateScoreMultipliers({
  isSameOrigin,
  outboundPageTransitionCount,
  intraSitePageTransitionCount,
}) {
  const effectivePageTransitionCount = isSameOrigin
    ? intraSitePageTransitionCount
    : outboundPageTransitionCount;

  return [buildTransitionFrequencyScoreMultiplier(effectivePageTransitionCount)];
}

async function scorePreloadCandidatePool(candidatePool, context = {}) {
  const candidatePoolWithAi = await appendAiKeywordScoreMultipliers(candidatePool, context);
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
    return new Map();
  }
  const aiContext = await getAiInterestKeywordsForPreloading(context);
  const graph = context?.graph ?? null;

  if (!graph || !Array.isArray(aiContext?.interestKeywords) || aiContext.interestKeywords.length === 0) {
    return new Map();
  }
  const targetPageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
    type: "get-page-keywords-batch",
    pageUrls: candidatePool.map((candidate) => candidate.targetPageUrl).filter(Boolean),
  });


  const multipliersByUrl = new Map();

  for (const candidate of candidatePool) {
    const keywordEntryLookupUrl = normalizePageUrlForIndex(
      candidate.targetPageUrl || candidate.url || ""
    );
    const aiKeywordMatch = aiKeywordTools.buildAiKeywordMatchResult({
      interestKeywords: aiContext.interestKeywords,
      candidate,
      targetPageKeywordEntry:
        targetPageKeywordsByUrl?.[keywordEntryLookupUrl] ??
        null,
    });
    multipliersByUrl.set(candidate.url, aiKeywordMatch);
  }

  return multipliersByUrl;
}

async function getAiInterestKeywordsForPreloading(context = {}) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const settings = context?.settings ?? null;
  const aiPredictionSettings = settings?.preloading?.aiPrediction ?? {};
  const backgroundFeatureSupport =
    globalThis.ZeroLatencySupport?.getBackgroundFeatureSupport?.() ?? {};
  const aiPredictionEnabled =
    aiPredictionSettings.enabled === true &&
    settings?.preloading?.effectiveAiPredictionModelDownloaded === true &&
    backgroundFeatureSupport.aiModelManagementUsable === true &&
    typeof globalThis.nativeAppInvokeAiModel === "function";
  const graph = context?.graph ?? null;

  if (!aiPredictionEnabled || !aiPredictionSettings.modelId || !aiKeywordTools || !graph) {
    return {
      interestKeywords: [],
      historyPagePool: null,
      recentForegroundPages: [],
      currentPage: null,
      openPages: [],
    };
  }

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
  const currentPage = {
    pageUrl: normalizePageUrlForIndex(context?.sourceUrl || ""),
    title: typeof context?.currentPageTitle === "string" ? context.currentPageTitle : "",
    textDigest:
      typeof context?.currentPageTextDigest === "string" ? context.currentPageTextDigest : "",
    contentFingerprint:
      typeof context?.currentPageContentFingerprint === "string"
        ? context.currentPageContentFingerprint
        : "",
  };
  const openPages = await collectOpenContextPages({
    graph,
    sourceWindowId: context?.sourceWindowId,
    currentPage,
    historyPagePool,
    recentForegroundPages,
  });
  const interestKeywords = await getAiInterestKeywords({
    modelId: aiPredictionSettings.modelId,
    currentPage,
    openPages,
    historyPagePool,
  });

  return {
    interestKeywords,
    historyPagePool,
    recentForegroundPages,
    currentPage,
    openPages,
  };
}

async function getAiInterestKeywords({ modelId, currentPage, openPages, historyPagePool }) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const historyPageRecords = aiKeywordTools.buildHistoryPagePoolRecords(historyPagePool);
  const cacheKey = JSON.stringify({
    modelId,
    currentPageUrl: currentPage?.pageUrl || "",
    currentFingerprint: currentPage?.contentFingerprint || "",
    openPageUrls: (openPages || []).map((page) => page.pageUrl),
    historyPageUrls: historyPageRecords.map((page) => page.pageUrl),
  });
  const cachedEntry = aiInterestKeywordCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.promise;
  }

  const inferencePromise = nativeAppInvokeAiModel({
    model_id: modelId,
    prompt: aiKeywordTools.buildManagedModelPrompt(
      modelId,
      aiKeywordTools.buildContextKeywordPrompt({
        currentPage,
        openPages,
        recentForegroundPages: historyPageRecords,
      })
    ),
    response_format: "json",
  })
    .then((result) => aiKeywordTools.parseAiKeywordInferenceResponse(result?.output_text))
    .then((result) => (Array.isArray(result?.keywords) ? result.keywords : []))
    .catch((error) => {
      console.error("AI interest keyword inference failed.", error);
      return [];
    });

  aiInterestKeywordCache.set(cacheKey, {
    expiresAt: Date.now() + AI_INTEREST_KEYWORD_CACHE_TTL_MS,
    promise: inferencePromise,
  });
  pruneAiInterestKeywordCache();
  return inferencePromise;
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
