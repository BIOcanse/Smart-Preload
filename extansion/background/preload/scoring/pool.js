async function scorePreloadCandidatePool(candidatePool, context = {}) {
  const scorableCandidatePool = (Array.isArray(candidatePool) ? candidatePool : []).filter(
    (candidate) => !candidate?.bookmarkPreload
  );
  const candidatePoolWithAi = await appendAiKeywordScoreMultipliers(
    scorableCandidatePool,
    context
  );
  const scoreInputs = candidatePoolWithAi.map((candidate) => ({
    baseScore: candidate.baseScore,
    multipliers: candidate.scoreMultipliers,
  }));
  const scoreBreakdowns = await scorePreloadCandidatesBatch(scoreInputs);

  return candidatePoolWithAi.map((candidate, index) =>
    applyPreloadCandidateScore(candidate, scoreBreakdowns[index] ?? null)
  );
}

function comparePreloadCandidateFrequency(left, right) {
  if (right.transitionCount !== left.transitionCount) {
    return right.transitionCount - left.transitionCount;
  }

  return comparePreloadCandidatePriority(left, right);
}

function comparePreloadCandidatePriority(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.visibilityScore !== left.visibilityScore) {
    return right.visibilityScore - left.visibilityScore;
  }

  return left.linkIndex - right.linkIndex;
}

function applyPreloadCandidateScore(candidate, breakdown) {
  const normalizedScore = Number(breakdown?.normalizedScore);

  return {
    ...candidate,
    scoreBreakdown: breakdown ?? null,
    score: Number.isFinite(normalizedScore) ? normalizedScore : candidate.baseScore,
  };
}

globalThis.ZeroLatencyPreloadScoringPool = {
  scorePreloadCandidatePool,
  comparePreloadCandidateFrequency,
  comparePreloadCandidatePriority,
  applyPreloadCandidateScore,
};
