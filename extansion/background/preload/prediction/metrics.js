async function getCandidateTransitionMetricsByUrl({
  graph,
  transitionWindowKey,
  sourceNodeId,
  sourcePageUrl,
  candidatePool,
}) {
  const batchQueryResult = await queryTrackingGraphFromGraph(graph, {
    type: "get-candidate-transition-metrics-batch",
    windowKey: transitionWindowKey,
    sourceNodeId,
    sourcePageUrl,
    candidates: candidatePool.map((candidate) => ({
      url: candidate.url,
      targetNodeId: candidate.nodeId,
      targetPageUrl: candidate.targetPageUrl,
    })),
  });
  const metricEntries = Array.isArray(batchQueryResult?.candidates)
    ? batchQueryResult.candidates
    : [];

  return new Map(metricEntries.map((candidateMetric) => [candidateMetric.url, candidateMetric]));
}

function enrichPreloadCandidateWithMetrics(candidate, candidateMetricsByUrl, context) {
  const metricEntry = candidateMetricsByUrl.get(candidate.url) ?? null;
  const siteTransitionCount = clampNonNegativeInt(metricEntry?.siteTransitionCount, 0);
  const pageTransitionCount = clampNonNegativeInt(metricEntry?.pageTransitionCount, 0);
  const outboundPageTransitionCount = clampNonNegativeInt(
    metricEntry?.outboundPageTransitionCount,
    candidate.isSameOrigin ? 0 : pageTransitionCount
  );
  const intraSitePageTransitionCount = clampNonNegativeInt(
    metricEntry?.intraSitePageTransitionCount,
    candidate.isSameOrigin ? pageTransitionCount : 0
  );
  const transitionCount = candidate.isSameOrigin
    ? intraSitePageTransitionCount
    : outboundPageTransitionCount;
  const baseScore = buildPreloadCandidateBaseScore();

  return {
    ...candidate,
    score: baseScore,
    baseScore,
    scoreMultipliers: buildPreloadCandidateScoreMultipliers({
      siteTransitionCount,
      pageTransitionCount,
      isSameOrigin: candidate.isSameOrigin,
      outboundPageTransitionCount,
      intraSitePageTransitionCount,
      targetHint: candidate.targetHint,
    }),
    siteTransitionCount,
    pageTransitionCount,
    outboundPageTransitionCount,
    intraSitePageTransitionCount,
    transitionCount,
    transitionStats:
      context.graph.edges[`${context.sourceNodeId} -> ${candidate.nodeId}`]?.transitionStats ??
      createEmptyTransitionStats(),
  };
}
