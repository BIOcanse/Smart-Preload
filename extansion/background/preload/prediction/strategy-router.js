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
}) {
  const sourceNodeId = currentNodeId || buildNodeSeed(sourceUrl).nodeId;
  const transitionWindowKey = getPreloadTransitionWindowKey(settings);
  const candidatePool = await buildPreloadCandidatePool({
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
  const filteredCandidatePool = await applyOrderedPreloadRules(
    candidatePool,
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
    siteSelection: candidate.siteSelection ?? null,
    strategy: candidate.strategy ?? determinePreloadStrategy(candidate, settings),
  }));

  return {
    selectedTargets: selectedTargetsWithStrategy,
    prerenderTargets: selectedTargetsWithStrategy
      .filter((candidate) => candidate.strategy === "prerender")
      .map((candidate) => ({
        url: candidate.url,
        targetHint: candidate.targetHint,
      })),
    prefetchTargets: selectedTargetsWithStrategy
      .filter((candidate) => candidate.strategy === "prefetch")
      .map((candidate) => ({
        url: candidate.url,
      })),
    tabTargets: selectedTargetsWithStrategy
      .filter((candidate) => candidate.strategy === "hidden-tab")
      .map((candidate) => ({
        url: candidate.url,
        nodeId: candidate.nodeId,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown ?? null,
        transitionMetrics: candidate.transitionMetrics ?? null,
        targetHint: candidate.targetHint,
        aiKeywordMatch: candidate.aiKeywordMatch ?? null,
        siteSelection: candidate.siteSelection ?? null,
      })),
  };
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
    return resolver(candidate, settings);
  }

  return "prefetch";
}

const PRELOAD_STRATEGY_RESOLVERS = {
  [PRELOAD_STRATEGY_SCENARIOS.SAME_ORIGIN]: determineSameOriginPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_CURRENT_TAB]:
    determineCrossSiteCurrentTabPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_NEW_TAB]: determineCrossSiteNewTabPreloadStrategy,
};
