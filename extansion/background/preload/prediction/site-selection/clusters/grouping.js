function buildCrossSiteCandidateSiteClusters(crossSiteCandidates) {
  const siteClustersByNodeId = new Map();

  for (const candidate of Array.isArray(crossSiteCandidates) ? crossSiteCandidates : []) {
    const siteNodeId = typeof candidate?.nodeId === "string" ? candidate.nodeId : "";

    if (!siteNodeId) {
      continue;
    }

    let siteCluster = siteClustersByNodeId.get(siteNodeId);

    if (!siteCluster) {
      siteCluster = {
        nodeId: siteNodeId,
        candidates: [],
      };
      siteClustersByNodeId.set(siteNodeId, siteCluster);
    }

    siteCluster.candidates.push(candidate);
  }

  return [...siteClustersByNodeId.values()]
    .map((siteCluster) => finalizeCrossSiteCandidateCluster(siteCluster))
    .filter(Boolean);
}

function finalizeCrossSiteCandidateCluster(siteCluster) {
  const candidates = Array.isArray(siteCluster?.candidates) ? siteCluster.candidates : [];

  if (candidates.length === 0) {
    return null;
  }

  const pageUrlSet = new Set(
    candidates
      .map((candidate) => normalizePageUrlForIndex(candidate?.targetPageUrl || candidate?.url || ""))
      .filter(Boolean)
  );
  const siteTransitionCount = candidates.reduce(
    (maxCount, candidate) => Math.max(maxCount, Number(candidate?.siteTransitionCount) || 0),
    0
  );

  return {
    nodeId: siteCluster.nodeId,
    candidates: [...candidates].sort(comparePreloadCandidatePriority),
    cap: Math.max(1, pageUrlSet.size || candidates.length),
    siteTransitionCount,
  };
}
