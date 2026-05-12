async function applyOrderedPreloadRules(candidatePool, settings, maxTargets) {
  const filteredCandidatePool = await applyOrderedPreloadRulesWithWasm(
    candidatePool,
    settings,
    maxTargets
  );

  if (Array.isArray(filteredCandidatePool)) {
    if (filteredCandidatePool.length > 0 || candidatePool.length === 0) {
      return filteredCandidatePool;
    }

    const fallbackCandidatePool = applyOrderedPreloadRulesFallback(
      candidatePool,
      settings,
      maxTargets
    );

    if (fallbackCandidatePool.length > 0) {
      console.warn(
        "Wasm preload rule filter returned an empty result; falling back to JS filter."
      );
      return fallbackCandidatePool;
    }

    return filteredCandidatePool;
  }

  return applyOrderedPreloadRulesFallback(candidatePool, settings, maxTargets);
}

async function applyOrderedPreloadRulesWithWasm(candidatePool, settings, maxTargets) {
  const input = buildPreloadRuleFilterInput(candidatePool, settings, maxTargets);
  const result = await filterPreloadCandidateMetrics(input);

  if (!Array.isArray(result?.keptIndices)) {
    return null;
  }

  const selectedIndices = Array.isArray(result?.selectedIndices)
    ? result.selectedIndices
    : Array.isArray(result?.orderedIndices)
      ? result.orderedIndices
      : result.keptIndices;

  return selectedIndices
    .map((candidateIndex) => candidatePool[candidateIndex])
    .filter(Boolean);
}

function buildPreloadRuleFilterInput(candidatePool, settings, maxTargets) {
  return {
    ruleItems: settings?.layout?.ruleCards?.items ?? {},
    maxTargets: normalizeOptionalMaxTargets(maxTargets),
    candidates: candidatePool.map((candidate) => ({
      score: candidate.score,
      visibilityScore: candidate.visibilityScore,
      linkIndex: candidate.linkIndex,
      bookmarkRank: clampNonNegativeInt(candidate?.bookmarkPreload?.rank, 0),
      googleBookmarkCandidate: Boolean(candidate?.bookmarkPreload),
    })),
  };
}

function applyOrderedPreloadRulesFallback(candidatePool, settings, maxTargets) {
  let workingPool = [...candidatePool];
  const ruleItems = settings?.layout?.ruleCards?.items ?? {};
  const bookmarkRuleCardState = ruleItems.googleBookmarkRank;

  if (settingsApi.isRuleCardEnabled(bookmarkRuleCardState)) {
    workingPool = workingPool.filter(
      (candidate) =>
        !candidate.bookmarkPreload ||
        settingsApi.evaluateRuleCardMetric(
          bookmarkRuleCardState,
          clampNonNegativeInt(candidate.bookmarkPreload.rank, 0)
        )
    );
  }

  workingPool.sort(comparePreloadCandidatePriority);
  const normalizedMaxTargets = normalizeOptionalMaxTargets(maxTargets);
  return workingPool.slice(
    0,
    normalizedMaxTargets === null ? workingPool.length : normalizedMaxTargets
  );
}

function normalizeOptionalMaxTargets(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Math.max(0, Math.trunc(numericValue));
}
