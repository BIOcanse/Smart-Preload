async function applySiteSelectionToCandidateGroupFallback(
  normalizedCandidatePool,
  options,
  siteClusters,
  aiKeywordMultipliersByNodeId
) {
  const pageSlotLimit = Number(options?.pageSlotLimit);
  const siteSelectionLimit = Number(options?.siteSelectionLimit);
  const selectionGroup = typeof options?.selectionGroup === "string" ? options.selectionGroup : "";
  const selectedSameOriginCandidates = selectFallbackSameOriginCandidates(
    normalizedCandidatePool,
    pageSlotLimit
  );
  const remainingCrossSitePageSlots = Math.max(
    0,
    pageSlotLimit - selectedSameOriginCandidates.length
  );

  if (remainingCrossSitePageSlots <= 0) {
    return selectedSameOriginCandidates;
  }

  if (siteClusters.length === 0) {
    return selectedSameOriginCandidates;
  }

  const selectedSiteClusters = await selectFallbackCrossSiteClusters(
    siteClusters,
    aiKeywordMultipliersByNodeId,
    siteSelectionLimit,
    remainingCrossSitePageSlots
  );

  if (selectedSiteClusters.length === 0) {
    return selectedSameOriginCandidates;
  }

  const selectedCrossSiteCandidates = buildFallbackSelectedCrossSiteCandidates(
    selectedSiteClusters,
    remainingCrossSitePageSlots,
    selectionGroup
  );

  return [...selectedSameOriginCandidates, ...selectedCrossSiteCandidates].sort(
    comparePreloadCandidatePriority
  );
}

function selectFallbackSameOriginCandidates(normalizedCandidatePool, pageSlotLimit) {
  return normalizedCandidatePool
    .filter((candidate) => candidate?.isSameSite)
    .sort(comparePreloadCandidatePriority)
    .slice(0, pageSlotLimit);
}

async function selectFallbackCrossSiteClusters(
  siteClusters,
  aiKeywordMultipliersByNodeId,
  siteSelectionLimit,
  remainingCrossSitePageSlots
) {
  const scoredSiteClusters = await scoreCrossSiteCandidateClusters(
    siteClusters,
    aiKeywordMultipliersByNodeId
  );
  const sortedSiteClusters = sortScoredCrossSiteCandidateClusters(scoredSiteClusters);
  const effectiveSelectedSiteCount = Math.min(
    siteSelectionLimit,
    remainingCrossSitePageSlots,
    sortedSiteClusters.length
  );

  return sortedSiteClusters.slice(0, effectiveSelectedSiteCount);
}

function buildFallbackSelectedCrossSiteCandidates(
  selectedSiteClusters,
  remainingCrossSitePageSlots,
  selectionGroup
) {
  const totalSelectedSiteCap = selectedSiteClusters.reduce(
    (sum, siteCluster) => sum + siteCluster.cap,
    0
  );
  const allocatedPageSlotCount = Math.min(remainingCrossSitePageSlots, totalSelectedSiteCap);
  const allocations = allocateSelectedSitePageSlots(
    allocatedPageSlotCount,
    selectedSiteClusters.map((siteCluster) => siteCluster.siteWeight),
    selectedSiteClusters.map((siteCluster) => siteCluster.cap)
  );

  return selectedSiteClusters.flatMap((siteCluster, index) =>
    buildFallbackSelectedCandidatesForSiteCluster(
      siteCluster,
      allocations[index] ?? 0,
      index + 1,
      selectionGroup
    )
  );
}

function buildFallbackSelectedCandidatesForSiteCluster(
  siteCluster,
  allocatedSlots,
  siteRank,
  selectionGroup
) {
  if (allocatedSlots <= 0) {
    return [];
  }

  return [...siteCluster.candidates]
    .sort(comparePreloadCandidatePriority)
    .slice(0, allocatedSlots)
    .map((candidate) => ({
      ...candidate,
      siteSelection: {
        siteNodeId: siteCluster.nodeId,
        siteWeight: siteCluster.siteWeight,
        siteTransitionCount: siteCluster.siteTransitionCount,
        cap: siteCluster.cap,
        allocatedSlots,
        siteRank,
        selectionGroup,
        aiKeywordMatch: siteCluster.siteAiKeywordMatch ?? null,
      },
    }));
}
