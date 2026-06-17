(function () {
  globalThis.ZeroLatencyTrackingGraphModelNormalize = {
    normalizeTrackingGraph,
    normalizePageKeywordStore,
    normalizeLinkBehaviorStore,
    normalizeLinkBehaviorRecord,
    normalizePageKeywordEntry,
    normalizeRecentForegroundPages,
    normalizeTransitionMessages,
    normalizeTransitionMessageRecord,
    compareTransitionMessages,
    getMaxTransitionSequence,
    getRecentTransitionPreview,
    getStoredTransitionMessageBucketLayer,
    getTransitionMessageBucketLayer,
    reconcileStartupTransitionCoverage,
    shouldReplayTransitionMessageFromStartupCheck,
    captureStoredEdgeSnapshots,
    isOccurredAfter,
    hasStoredTransitionMessageReference,
  };
})();
