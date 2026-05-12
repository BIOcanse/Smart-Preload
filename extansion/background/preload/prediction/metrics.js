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
  const isSameSite =
    typeof metricEntry?.isSameSiteCandidate === "boolean"
      ? metricEntry.isSameSiteCandidate
      : candidate.nodeId === context.sourceNodeId;
  const outboundPageTransitionCount = clampNonNegativeInt(
    metricEntry?.outboundPageTransitionCount,
    isSameSite ? 0 : pageTransitionCount
  );
  const intraSitePageTransitionCount = clampNonNegativeInt(
    metricEntry?.intraSitePageTransitionCount,
    isSameSite ? pageTransitionCount : 0
  );
  const transitionCount = isSameSite
    ? intraSitePageTransitionCount
    : outboundPageTransitionCount;
  const baseScore = buildPreloadCandidateBaseScore();

  const scoreMultipliers = [
    ...buildPreloadCandidateScoreMultipliers({
      siteTransitionCount,
      pageTransitionCount,
      isSameSite,
      outboundPageTransitionCount,
      intraSitePageTransitionCount,
      targetHint: candidate.targetHint,
    }),
    ...(Array.isArray(candidate.extraScoreMultipliers)
      ? candidate.extraScoreMultipliers.filter((value) => Number.isFinite(Number(value)))
      : []),
  ];

  return {
    ...candidate,
    score: baseScore,
    baseScore,
    scoreMultipliers,
    isSameSite,
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
