(function () {
  globalThis.ZeroLatencyPreloadPrediction = {
    selectPreloadTargets,
    buildScoredPreloadCandidatePool,
    selectPreloadTargetsFromScoredCandidatePool,
    buildPreloadSchedulerScoreSignals,
    determinePreloadStrategy,
    getPreloadTransitionWindowKey,
    buildPreloadCandidatePool,
    getCandidateTransitionMetricsByUrl,
    enrichPreloadCandidateWithMetrics,
  };
})();
