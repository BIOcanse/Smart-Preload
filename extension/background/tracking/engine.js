(function () {
  globalThis.ZeroLatencyTrackingEngine = {
    applyTrackingEvent,
    getVisitGraphEngine,
    createVisitGraphEngine,
    wrapVisitGraphEngine,
    sanitizeTrackingStateForWasm,
    queryTrackingGraphFallback,
    queryTrackingGraph,
    queryTrackingGraphFromGraph,
    scorePreloadCandidatesBatch,
    filterPreloadCandidateMetrics,
    selectPreloadCandidateGroup,
  };
})();
