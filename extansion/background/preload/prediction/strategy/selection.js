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
    realPreloadSafety: candidate.realPreloadSafety ?? null,
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
        realPreloadSafety: candidate.realPreloadSafety ?? null,
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
