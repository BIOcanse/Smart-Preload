(function () {
  const {
    resolvePreloadAttentionOptions,
    recordSchedulerEvent,
  } = globalThis.ZeroLatencyPreloadAttentionOptions;
  const {
    applyPreloadAttentionPendingToCursor,
  } = globalThis.ZeroLatencyPreloadAttentionPending;
  const {
    buildAttentionCursorFromObservation,
    summarizeAttentionCursor,
  } = globalThis.ZeroLatencyPreloadAttentionCursor;
  const {
    resolveAttentionObservationClock,
    buildAttentionObservationTiming,
  } = globalThis.ZeroLatencyPreloadAttentionObservationTiming;
  const {
    commitPreloadAttentionElapsed,
  } = globalThis.ZeroLatencyPreloadAttentionObservationCommit;

  function recordPreloadAttentionObservation(preloadState, observation, options = {}) {
    const targetState = isPlainObject(preloadState) ? preloadState : createEmptyPreloadState();
    const scheduler = normalizePreloadSchedulerState(targetState.scheduler);
    const resolvedOptions = resolvePreloadAttentionOptions(options);
    const { observedAtMs, observedAt } = resolveAttentionObservationClock(observation);
    const previousCursor = normalizePreloadAttentionCursor(scheduler.activeTabCursor);
    const nextCursor = buildAttentionCursorFromObservation(observation, observedAt);
    const timing = buildAttentionObservationTiming({
      previousCursor,
      observedAtMs,
      resolvedOptions,
    });
    const commit = commitPreloadAttentionElapsed({
      scheduler,
      previousCursor,
      timing,
      resolvedOptions,
      observedAt,
    });

    applyPreloadAttentionPendingToCursor(nextCursor, scheduler);

    scheduler.activeTabCursor = nextCursor;
    scheduler.updatedAt = observedAt;
    targetState.scheduler = scheduler;
    targetState.updatedAt = observedAt;

    recordSchedulerEvent("scheduler.attention.observation", {
      reason: typeof observation?.reason === "string" ? observation.reason : null,
      observedAt,
      previous: summarizeAttentionCursor(previousCursor),
      next: summarizeAttentionCursor(nextCursor),
      elapsedMs: timing.elapsedMs,
      wallElapsedMs: timing.wallElapsedMs,
      weightedElapsedMs: timing.weightedElapsedMs,
      previousWeight: timing.previousWeight,
      minSliceMs: resolvedOptions.minSliceMs,
      maxObservableGapMs: resolvedOptions.maxObservableGapMs,
      segmentDurationMs: resolvedOptions.segmentDurationMs,
      shouldRecordElapsed: timing.shouldRecordElapsed,
      pendingBeforeMs: commit.pendingBeforeMs,
      pendingAfterMs: commit.pendingAfterMs,
      recordedDurationMs: commit.recordedDurationMs,
      committedSegmentCount: commit.committedSegmentCount,
      skippedLongGap: timing.skippedLongGap,
      poolTotalDurationMs: scheduler.attentionPool.totalDurationMs,
    });

    return {
      preloadState: targetState,
      recordedDurationMs: commit.recordedDurationMs,
      skippedLongGap: timing.skippedLongGap,
    };
  }

  async function recordPreloadAttentionObservationAndMaybeReschedule(
    preloadState,
    observation,
    options = {}
  ) {
    const result = recordPreloadAttentionObservation(preloadState, observation, options);
    return globalThis.ZeroLatencyPreloadAttentionReschedule
      .reschedulePreloadAttentionObservationResult(result);
  }

  async function notifyAttentionReschedule(result) {
    return globalThis.ZeroLatencyPreloadAttentionReschedule.notifyAttentionReschedule(result);
  }

  globalThis.ZeroLatencyPreloadAttentionObservation = {
    recordPreloadAttentionObservation,
    recordPreloadAttentionObservationAndMaybeReschedule,
    notifyAttentionReschedule,
  };
})();
