(function () {
  const {
    recordSchedulerEvent,
  } = globalThis.ZeroLatencyPreloadAttentionOptions;
  const {
    appendPreloadAttentionDuration,
  } = globalThis.ZeroLatencyPreloadAttentionPool;
  const {
    getPreloadAttentionPendingEntry,
    setPreloadAttentionPendingEntry,
  } = globalThis.ZeroLatencyPreloadAttentionPending;

  function commitPreloadAttentionElapsed({
    scheduler,
    previousCursor,
    timing,
    resolvedOptions,
    observedAt,
  }) {
    let recordedDurationMs = 0;
    let pendingBeforeMs = 0;
    let pendingAfterMs = 0;
    let committedSegmentCount = 0;

    if (previousCursor.counting === true) {
      pendingBeforeMs = clampNonNegativeNumber(
        getPreloadAttentionPendingEntry(scheduler, previousCursor)?.durationMs,
        0
      );
      pendingAfterMs = pendingBeforeMs;
    }

    if (!timing.shouldRecordElapsed) {
      return {
        recordedDurationMs,
        pendingBeforeMs,
        pendingAfterMs,
        committedSegmentCount,
      };
    }

    const pendingEntry = getPreloadAttentionPendingEntry(scheduler, previousCursor);
    let pendingDurationMs = pendingBeforeMs;
    const pendingStartedAt =
      pendingEntry?.startedAt ||
      previousCursor.pendingStartedAt ||
      previousCursor.observedAt ||
      observedAt;

    pendingDurationMs += timing.weightedElapsedMs;
    const segmentDurationMs = resolvedOptions.segmentDurationMs;
    const committableDurationMs =
      Math.floor(pendingDurationMs / segmentDurationMs) * segmentDurationMs;

    if (committableDurationMs > 0) {
      pendingDurationMs -= committableDurationMs;
      committedSegmentCount = Math.floor(committableDurationMs / segmentDurationMs);
      const committedEndedAtMs = timing.effectiveObservedAtMs;
      const committedStartedAtMs = Math.max(
        0,
        committedEndedAtMs - committableDurationMs
      );

      scheduler.attentionPool = appendPreloadAttentionDuration(
        scheduler.attentionPool,
        {
          tabId: previousCursor.tabId,
          windowId: previousCursor.windowId,
          pageUrl: previousCursor.pageUrl,
          durationMs: committableDurationMs,
          startedAt: new Date(committedStartedAtMs).toISOString(),
          endedAt: new Date(committedEndedAtMs).toISOString(),
        },
        resolvedOptions
      );
      recordedDurationMs = committableDurationMs;
      recordSchedulerEvent("scheduler.attention.segment-committed", {
        sourceTabId: previousCursor.tabId,
        sourceWindowId: previousCursor.windowId,
        sourcePageUrl: previousCursor.pageUrl,
        durationMs: committableDurationMs,
        segmentDurationMs,
        segmentCount: committedSegmentCount,
        pendingBeforeMs,
        pendingAfterMs: pendingDurationMs,
        poolTotalDurationMs: scheduler.attentionPool.totalDurationMs,
        startedAt: new Date(committedStartedAtMs).toISOString(),
        endedAt: new Date(committedEndedAtMs).toISOString(),
      });
    }

    setPreloadAttentionPendingEntry(
      scheduler,
      previousCursor,
      pendingDurationMs,
      pendingStartedAt,
      observedAt
    );
    pendingAfterMs = pendingDurationMs;

    return {
      recordedDurationMs,
      pendingBeforeMs,
      pendingAfterMs,
      committedSegmentCount,
    };
  }

  globalThis.ZeroLatencyPreloadAttentionObservationCommit = {
    commitPreloadAttentionElapsed,
  };
})();
