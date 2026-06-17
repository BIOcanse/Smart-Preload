async function scoreCrossSiteCandidateClusters(siteClusters, aiKeywordMultipliersByNodeId) {
  const normalizedSiteClusters = Array.isArray(siteClusters) ? siteClusters : [];
  const scoreInputs = normalizedSiteClusters.map((siteCluster) => {
    const siteAiKeywordMatch = aiKeywordMultipliersByNodeId.get(siteCluster.nodeId) ?? null;
    const multipliers = [
      buildTransitionFrequencyScoreMultiplier(siteCluster.siteTransitionCount),
    ];

    if (siteAiKeywordMatch?.multiplier > 1) {
      multipliers.push(siteAiKeywordMatch.multiplier);
    }

    return {
      baseScore: buildPreloadCandidateBaseScore(),
      multipliers,
    };
  });
  const scoreBreakdowns = await scorePreloadCandidatesBatch(scoreInputs);

  return normalizedSiteClusters
    .map((siteCluster, index) => {
      const scoreBreakdown = scoreBreakdowns[index] ?? null;
      const normalizedScore = Number(scoreBreakdown?.normalizedScore);

      return {
        ...siteCluster,
        siteAiKeywordMatch: aiKeywordMultipliersByNodeId.get(siteCluster.nodeId) ?? null,
        siteScoreBreakdown: scoreBreakdown,
        siteWeight: Number.isFinite(normalizedScore)
          ? normalizedScore
          : buildPreloadCandidateBaseScore(),
      };
    });
}

function sortScoredCrossSiteCandidateClusters(siteClusters) {
  return [...(Array.isArray(siteClusters) ? siteClusters : [])].sort(
    compareSiteClusterPriority
  );
}

function compareSiteClusterPriority(left, right) {
  if ((right?.siteWeight ?? 0) !== (left?.siteWeight ?? 0)) {
    return (right?.siteWeight ?? 0) - (left?.siteWeight ?? 0);
  }

  if ((right?.siteTransitionCount ?? 0) !== (left?.siteTransitionCount ?? 0)) {
    return (right?.siteTransitionCount ?? 0) - (left?.siteTransitionCount ?? 0);
  }

  const rightBestCandidate = right?.candidates?.[0];
  const leftBestCandidate = left?.candidates?.[0];

  if (rightBestCandidate && leftBestCandidate) {
    return comparePreloadCandidatePriority(leftBestCandidate, rightBestCandidate);
  }

  return 0;
}
