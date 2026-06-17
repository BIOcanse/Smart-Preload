async function trySelectPreloadCandidateGroupWithEngine(
  candidatePool,
  options,
  aiKeywordMultipliersByNodeId
) {
  if (typeof selectPreloadCandidateGroup !== "function") {
    return null;
  }

  const result = await selectPreloadCandidateGroup(
    buildEngineSelectionRequest(candidatePool, options, aiKeywordMultipliersByNodeId)
  );

  if (!result || !Array.isArray(result.selectedIndices)) {
    return null;
  }

  return mapEngineSelectionResultToCandidates(result, candidatePool, aiKeywordMultipliersByNodeId);
}

function buildEngineSelectionRequest(candidatePool, options, aiKeywordMultipliersByNodeId) {
  const pageSlotLimit = Number(options?.pageSlotLimit);
  const siteSelectionLimit = Number(options?.siteSelectionLimit);
  const selectionGroup = typeof options?.selectionGroup === "string" ? options.selectionGroup : "";

  return {
    pageSlotLimit: Number.isFinite(pageSlotLimit) ? Math.max(0, Math.trunc(pageSlotLimit)) : 0,
    siteSelectionLimit: Number.isFinite(siteSelectionLimit)
      ? Math.max(0, Math.trunc(siteSelectionLimit))
      : 0,
    selectionGroup,
    candidates: candidatePool.map((candidate, index) =>
      buildEngineSelectionCandidateInput(candidate, index, aiKeywordMultipliersByNodeId)
    ),
  };
}

function buildEngineSelectionCandidateInput(candidate, index, aiKeywordMultipliersByNodeId) {
  const siteAiKeywordMatch = aiKeywordMultipliersByNodeId.get(candidate?.nodeId) ?? null;

  return {
    index,
    nodeId: typeof candidate?.nodeId === "string" ? candidate.nodeId : "",
    url: typeof candidate?.url === "string" ? candidate.url : "",
    targetPageUrl: normalizePageUrlForIndex(candidate?.targetPageUrl || candidate?.url || "") || "",
    isSameSite: candidate?.isSameSite === true,
    siteTransitionCount: clampNonNegativeInt(candidate?.siteTransitionCount, 0),
    siteAiKeywordMultiplier:
      Number.isFinite(Number(siteAiKeywordMatch?.multiplier)) &&
      Number(siteAiKeywordMatch.multiplier) > 1
        ? Number(siteAiKeywordMatch.multiplier)
        : 1,
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    visibilityScore: Number.isFinite(Number(candidate?.visibilityScore))
      ? Number(candidate.visibilityScore)
      : 0,
    linkIndex: clampNonNegativeInt(candidate?.linkIndex, index),
  };
}

function mapEngineSelectionResultToCandidates(result, candidatePool, aiKeywordMultipliersByNodeId) {
  const candidateByIndex = new Map(candidatePool.map((candidate, index) => [index, candidate]));
  const siteSelectionByCandidateIndex = new Map(
    (Array.isArray(result.siteSelections) ? result.siteSelections : [])
      .map((siteSelection) => [
        normalizeSelectionCandidateIndex(siteSelection?.candidateIndex),
        siteSelection,
      ])
      .filter(([candidateIndex]) => candidateIndex !== null)
  );

  return result.selectedIndices
    .map((candidateIndex) => {
      const normalizedCandidateIndex = normalizeSelectionCandidateIndex(candidateIndex);
      const candidate = candidateByIndex.get(normalizedCandidateIndex);

      if (!candidate) {
        return null;
      }

      const siteSelection = siteSelectionByCandidateIndex.get(normalizedCandidateIndex);

      if (!siteSelection) {
        return candidate;
      }

      return {
        ...candidate,
        siteSelection: {
          siteNodeId:
            typeof siteSelection.siteNodeId === "string" ? siteSelection.siteNodeId : "",
          siteWeight: Number(siteSelection.siteWeight) || 0,
          siteTransitionCount: clampNonNegativeInt(siteSelection.siteTransitionCount, 0),
          cap: clampNonNegativeInt(siteSelection.cap, 0),
          allocatedSlots: clampNonNegativeInt(siteSelection.allocatedSlots, 0),
          siteRank: clampNonNegativeInt(siteSelection.siteRank, 0),
          selectionGroup:
            typeof siteSelection.selectionGroup === "string"
              ? siteSelection.selectionGroup
              : "",
          siteScoreBreakdown: siteSelection.siteScoreBreakdown ?? null,
          aiKeywordMatch:
            aiKeywordMultipliersByNodeId.get(siteSelection.siteNodeId) ?? null,
        },
      };
    })
    .filter(Boolean);
}

function normalizeSelectionCandidateIndex(value) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 0) {
    return null;
  }

  return numericValue;
}
