(function () {
  globalThis.ZeroLatencyPreloadPrediction = {
    selectPreloadTargets,
    determinePreloadStrategy,
    getPreloadTransitionWindowKey,
    buildPreloadCandidatePool,
    getCandidateTransitionMetricsByUrl,
    enrichPreloadCandidateWithMetrics,
  };
})();
