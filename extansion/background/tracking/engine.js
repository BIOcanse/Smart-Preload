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
    scorePreloadCandidate,
    scorePreloadCandidatesBatch,
    filterPreloadCandidateMetrics,
    selectPreloadCandidateGroup,
  };
})();
