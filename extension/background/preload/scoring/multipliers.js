function buildPreloadCandidateBaseScore() {
  return PRELOAD_BASE_SCORE;
}

function buildFrequencyLikeScoreMultiplier(signal, options = {}) {
  const normalizedSignal = Number(signal);
  const sanitizedSignal = Number.isFinite(normalizedSignal)
    ? Math.max(
        0,
        options?.truncate === true ? Math.trunc(normalizedSignal) : normalizedSignal
      )
    : 0;

  if (sanitizedSignal <= 0) {
    return 1;
  }

  const normalizedLogDistance =
    (Math.log(sanitizedSignal) - TRANSITION_FREQUENCY_LOG_MEAN) /
    TRANSITION_FREQUENCY_LOG_SD;

  return 1 + TRANSITION_FREQUENCY_SIGMOID_SCALE / (1 + Math.exp(-normalizedLogDistance));
}

function buildSchedulerLinkValueMultiplier(signal) {
  const normalizedSignal = Number(signal);
  const sanitizedSignal = Number.isFinite(normalizedSignal)
    ? Math.max(0, normalizedSignal)
    : 0;

  return 1 + Math.log1p(sanitizedSignal);
}

function buildTransitionFrequencyScoreMultiplier(transitionCount) {
  return buildFrequencyLikeScoreMultiplier(transitionCount, { truncate: true });
}

function buildPreloadCandidateScoreMultipliers({
  isSameSite,
  isSameOrigin,
  outboundPageTransitionCount,
  intraSitePageTransitionCount,
}) {
  const shouldUseIntraSiteCount =
    typeof isSameSite === "boolean" ? isSameSite : isSameOrigin === true;
  const effectivePageTransitionCount = shouldUseIntraSiteCount
    ? intraSitePageTransitionCount
    : outboundPageTransitionCount;

  return [buildTransitionFrequencyScoreMultiplier(effectivePageTransitionCount)];
}

globalThis.ZeroLatencyPreloadScoringMultipliers = {
  buildPreloadCandidateBaseScore,
  buildFrequencyLikeScoreMultiplier,
  buildSchedulerLinkValueMultiplier,
  buildTransitionFrequencyScoreMultiplier,
  buildPreloadCandidateScoreMultipliers,
};
