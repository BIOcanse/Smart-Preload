async function selectPreloadTargets({
  currentNodeId,
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  currentPageTitle,
  currentPageTextDigest,
  currentPageContentFingerprint,
  candidateLinks,
  graph,
  settings,
  slotLimits,
  ignoreConfiguredSourceSlotCaps = false,
}) {
  const scoredCandidatePool = await buildScoredPreloadCandidatePool({
    currentNodeId,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    candidateLinks,
    graph,
    settings,
  });

  return selectPreloadTargetsFromScoredCandidatePool({
    scoredCandidatePool,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    graph,
    settings,
    slotLimits,
    ignoreConfiguredSourceSlotCaps,
  });
}

async function buildScoredPreloadCandidatePool({
  currentNodeId,
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  currentPageTitle,
  currentPageTextDigest,
  currentPageContentFingerprint,
  candidateLinks,
  graph,
  settings,
}) {
  const sourceNodeId = currentNodeId || buildNodeSeed(sourceUrl).nodeId;
  const transitionWindowKey = getPreloadTransitionWindowKey(settings);

  return buildPreloadCandidatePool({
    sourceNodeId,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    candidateLinks,
    graph,
    settings,
    transitionWindowKey,
  });
}

async function selectPreloadTargetsFromScoredCandidatePool({
  scoredCandidatePool,
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  currentPageTitle,
  currentPageTextDigest,
  currentPageContentFingerprint,
  graph,
  settings,
  slotLimits,
  ignoreConfiguredSourceSlotCaps = false,
}) {
  const filteredCandidatePool = await applyOrderedPreloadRules(
    Array.isArray(scoredCandidatePool) ? scoredCandidatePool : [],
    settings,
    null
  );
  const filteredCandidatePoolWithStrategy = filteredCandidatePool.map((candidate) => ({
    ...candidate,
    strategy: determinePreloadStrategy(candidate, settings),
  }));
  const candidatePoolWithSiteSelection = await applySiteSelectionToPreloadCandidatePool(
    filteredCandidatePoolWithStrategy,
    {
      graph,
      settings,
      sourceUrl,
      sourceWindowId,
      sourceTabId,
      currentPageTitle,
      currentPageTextDigest,
      currentPageContentFingerprint,
      slotLimits,
      ignoreConfiguredSourceSlotCaps,
    }
  );
  const selectedTargetsWithStrategy = candidatePoolWithSiteSelection.map((candidate) => ({
    url: candidate.url,
    nodeId: candidate.nodeId,
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown ?? null,
    transitionMetrics: buildCandidateTransitionMetricSnapshot(candidate),
    targetHint: candidate.targetHint,
    aiKeywordMatch: candidate.aiKeywordMatch ?? null,
    bookmarkPreload: null,
    siteSelection: candidate.siteSelection ?? null,
    strategy: candidate.strategy ?? determinePreloadStrategy(candidate, settings),
  }));
  const independentBookmarkTargets = await buildIndependentGoogleBookmarkPreloadTargets({
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    graph,
    settings,
  });
  const selectedTargets = [
    ...selectedTargetsWithStrategy,
    ...independentBookmarkTargets,
  ];

  return {
    selectedTargets,
    prerenderTargets: selectedTargets
      .filter((candidate) => candidate.strategy === "prerender")
      .map((candidate) => ({
        url: candidate.url,
        targetHint: candidate.targetHint,
      })),
    prefetchTargets: selectedTargets
      .filter((candidate) => candidate.strategy === "prefetch")
      .map((candidate) => ({
        url: candidate.url,
      })),
    tabTargets: selectedTargets
      .filter((candidate) => candidate.strategy === "hidden-tab")
      .map((candidate) => ({
        url: candidate.url,
        nodeId: candidate.nodeId,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown ?? null,
        transitionMetrics: candidate.transitionMetrics ?? null,
        targetHint: candidate.targetHint,
        aiKeywordMatch: candidate.aiKeywordMatch ?? null,
        bookmarkPreload: candidate.bookmarkPreload ?? null,
        siteSelection: candidate.siteSelection ?? null,
      })),
  };
}

async function buildIndependentGoogleBookmarkPreloadTargets(context) {
  if (typeof buildGoogleBookmarkPreloadTargets !== "function") {
    return [];
  }

  try {
    return await buildGoogleBookmarkPreloadTargets(context);
  } catch (error) {
    console.warn("Failed to build independent Google bookmark preload targets.", error);
    globalThis.ZeroLatencyDebugEvents?.record?.("prediction.google-bookmarks.targets.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function buildPreloadSchedulerScoreSignals(scoredCandidatePool, settings) {
  const signals = {
    native: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
    tab: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
  };

  for (const candidate of Array.isArray(scoredCandidatePool) ? scoredCandidatePool : []) {
    if (candidate?.bookmarkPreload) {
      continue;
    }

    const selectionGroup =
      determinePreloadStrategy(candidate, settings) === "hidden-tab" ? "tab" : "native";
    const score = Number(candidate?.score);

    signals[selectionGroup].scoreSum += buildSchedulerLinkScoreSignal(score);
    signals[selectionGroup].candidateCount += 1;
  }

  signals.native.linkValueMultiplier = buildSchedulerLinkValueMultiplier(
    signals.native.scoreSum
  );
  signals.tab.linkValueMultiplier = buildSchedulerLinkValueMultiplier(signals.tab.scoreSum);
  return signals;
}

function buildSchedulerLinkScoreSignal(score) {
  const normalizedScore = Number(score);

  if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
    return 0;
  }

  return normalizedScore ** 1.5;
}

function buildCandidateTransitionMetricSnapshot(candidate) {
  return {
    siteTransitionCount: clampNonNegativeInt(candidate?.siteTransitionCount, 0),
    outboundPageTransitionCount: clampNonNegativeInt(
      candidate?.outboundPageTransitionCount,
      0
    ),
    intraSitePageTransitionCount: clampNonNegativeInt(
      candidate?.intraSitePageTransitionCount,
      0
    ),
    pageTransitionCount: clampNonNegativeInt(candidate?.pageTransitionCount, 0),
    isSameSite: candidate?.isSameSite === true,
  };
}

function determinePreloadStrategy(candidate, settings) {
  const scenario = determinePreloadStrategyScenario(candidate);
  const resolver = PRELOAD_STRATEGY_RESOLVERS[scenario];

  if (typeof resolver === "function") {
    const strategy = resolver(candidate, settings);
    return globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.resolveHiddenTabStrategyForNativeOnlyMode?.(
      strategy,
      settings
    ) ?? strategy;
  }

  return "prefetch";
}

const PRELOAD_STRATEGY_RESOLVERS = {
  [PRELOAD_STRATEGY_SCENARIOS.SAME_ORIGIN]: determineSameOriginPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_CURRENT_TAB]:
    determineCrossSiteCurrentTabPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_NEW_TAB]: determineCrossSiteNewTabPreloadStrategy,
};
