function getPreloadTransitionWindowKey(settings) {
  return settingsApi.normalizeTransitionWindowKey?.(
    settings?.preloading?.effectiveTransitionWindowKey,
    "total"
  ) ?? "total";
}

async function buildPreloadCandidatePool({
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
  transitionWindowKey = "total",
}) {
  const sourcePageUrl = normalizePageUrlForIndex(sourceUrl);
  const sourceCandidateLinks = Array.isArray(candidateLinks) ? candidateLinks : [];
  const candidatePoolByUrl = buildLinkCandidatePoolByUrl({
    sourceNodeId,
    sourceUrl,
    graph,
    settings,
    sourcePageUrl,
    sourceCandidateLinks,
    transitionWindowKey,
  });

  const candidatePool = filterSourceSpecificCandidatePool(
    [...candidatePoolByUrl.values()],
    sourceUrl
  );

  if (candidatePool.length === 0) {
    return [];
  }

  const enrichedCandidatePool = await enrichPreloadCandidatePoolWithMetrics(candidatePool, {
    graph,
    transitionWindowKey,
    sourceNodeId,
    sourcePageUrl,
  });

  return scorePreloadCandidatePool(enrichedCandidatePool, {
    graph,
    settings,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
  });
}

async function enrichPreloadCandidatePoolWithMetrics(candidatePool, context) {
  const candidateMetricsByUrl = await getCandidateTransitionMetricsByUrl({
    graph: context.graph,
    transitionWindowKey: context.transitionWindowKey,
    sourceNodeId: context.sourceNodeId,
    sourcePageUrl: context.sourcePageUrl,
    candidatePool,
  });

  return candidatePool
    .map((candidate) =>
      enrichPreloadCandidateWithMetrics(candidate, candidateMetricsByUrl, {
        graph: context.graph,
        sourceNodeId: context.sourceNodeId,
      })
    )
    .filter(Boolean);
}
