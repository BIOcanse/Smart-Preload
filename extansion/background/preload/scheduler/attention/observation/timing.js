(function () {
  const {
    normalizeWeight,
    parseTimestampMs,
  } = globalThis.ZeroLatencyPreloadAttentionOptions;

  function resolveAttentionObservationClock(observation) {
    const observedAtMs = parseTimestampMs(observation?.observedAt) ?? Date.now();

    return {
      observedAtMs,
      observedAt: new Date(observedAtMs).toISOString(),
    };
  }

  function buildAttentionObservationTiming({
    previousCursor,
    observedAtMs,
    resolvedOptions,
  }) {
    const previousObservedAtMs = parseTimestampMs(previousCursor.observedAt);
    const wallElapsedMs =
      previousObservedAtMs === null ? 0 : Math.max(0, observedAtMs - previousObservedAtMs);
    const previousExpiresAtMs = parseTimestampMs(previousCursor.expiresAt);
    const effectiveObservedAtMs =
      previousExpiresAtMs === null ? observedAtMs : Math.min(observedAtMs, previousExpiresAtMs);
    const elapsedMs =
      previousObservedAtMs === null
        ? 0
        : Math.max(0, effectiveObservedAtMs - previousObservedAtMs);
    const previousWeight = normalizeWeight(previousCursor.weight, 0);
    const weightedElapsedMs = elapsedMs * previousWeight;
    const shouldRecordElapsed =
      previousCursor.counting === true &&
      elapsedMs >= resolvedOptions.minSliceMs &&
      wallElapsedMs <= resolvedOptions.maxObservableGapMs &&
      weightedElapsedMs > 0;
    const skippedLongGap =
      previousCursor.counting === true &&
      previousObservedAtMs !== null &&
      wallElapsedMs > resolvedOptions.maxObservableGapMs;

    return {
      previousObservedAtMs,
      wallElapsedMs,
      previousExpiresAtMs,
      effectiveObservedAtMs,
      elapsedMs,
      previousWeight,
      weightedElapsedMs,
      shouldRecordElapsed,
      skippedLongGap,
    };
  }

  globalThis.ZeroLatencyPreloadAttentionObservationTiming = {
    resolveAttentionObservationClock,
    buildAttentionObservationTiming,
  };
})();
