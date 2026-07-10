(function () {
  const {
    buildPreloadAttentionRuntimeOptions,
  } = globalThis.ZeroLatencyPreloadAttentionActivity;
  const {
    recordPreloadAttentionObservationAndMaybeReschedule,
    notifyAttentionReschedule,
  } = globalThis.ZeroLatencyPreloadAttentionObservation;
  const ATTENTION_LIFECYCLE_BOUNDARY_REASONS = new Set([
    "committed",
    "history-state-updated",
    "tab-activated",
    "tab-removed",
    "window-focused",
    "window-removed",
  ]);
  let volatileAttentionState = null;
  let attentionStateEpoch = 0;

  async function commitPreloadAttentionRuntimeObservation({
    observation,
    runtimeOptions,
    options = {},
    skipPreloadTabId = null,
  }) {
    let result = null;
    const requestEpoch = attentionStateEpoch;
    const normalizedSkipTabId = normalizePositiveInteger(skipPreloadTabId);
    const task = async () => {
      if (requestEpoch !== attentionStateEpoch) {
        return;
      }

      const preloadState = applyVolatileAttentionState(await loadPreloadState());

      if (normalizedSkipTabId !== null && isPreloadTab(preloadState, normalizedSkipTabId)) {
        return;
      }

      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        observation,
        runtimeOptions
      );
      volatileAttentionState = captureVolatileAttentionState(result.preloadState);

      if (shouldPersistAttentionObservation(result, observation, options)) {
        await savePreloadState(result.preloadState);
        volatileAttentionState = null;
        result.persisted = true;
      } else {
        result.persisted = false;
      }
    };

    await runPreloadAttentionMutation(task, options, () => result);
  }

  async function pausePreloadAttentionCursorMutation(reason = "pause", options = {}) {
    let result = null;
    const task = async () => {
      const preloadState = applyVolatileAttentionState(await loadPreloadState());
      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          observedAt: new Date().toISOString(),
          counting: false,
          reason,
        },
        buildPreloadAttentionRuntimeOptions(options)
      );
      volatileAttentionState = captureVolatileAttentionState(result.preloadState);
      await savePreloadState(result.preloadState);
      volatileAttentionState = null;
      result.persisted = true;
    };

    await runPreloadAttentionMutation(task, options, () => result);
  }

  async function pausePreloadAttentionCursorIfMatchesMutation(
    match,
    reason = "pause-matched",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(match?.tabId);
    const windowId = normalizePositiveInteger(match?.windowId);

    if (tabId === null && windowId === null) {
      return;
    }

    let result = null;
    const task = async () => {
      const preloadState = applyVolatileAttentionState(await loadPreloadState());
      const cursor = normalizePreloadAttentionCursor(
        preloadState?.scheduler?.activeTabCursor
      );
      const tabMatches = tabId === null || cursor.tabId === tabId;
      const windowMatches = windowId === null || cursor.windowId === windowId;

      if (!tabMatches || !windowMatches) {
        return;
      }

      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          observedAt: new Date().toISOString(),
          counting: false,
          reason,
        },
        buildPreloadAttentionRuntimeOptions(options)
      );
      volatileAttentionState = captureVolatileAttentionState(result.preloadState);
      await savePreloadState(result.preloadState);
      volatileAttentionState = null;
      result.persisted = true;
    };

    await runPreloadAttentionMutation(task, options, () => result);
  }

  async function flushPendingAttention(reason = "lifecycle-boundary") {
    if (typeof globalThis.queueAttention === "function") {
      return globalThis.queueAttention("attention-runtime:flush", () =>
        flushPendingAttentionNow(reason)
      );
    }

    return flushPendingAttentionNow(reason);
  }

  async function flushPendingAttentionNow(reason) {
    if (!volatileAttentionState) {
      return { ok: true, flushed: false, reason };
    }

    const task = async () => {
      const preloadState = applyVolatileAttentionState(await loadPreloadState());
      await savePreloadState(preloadState);
      volatileAttentionState = null;
    };

    if (typeof globalThis.queueMutation === "function") {
      await globalThis.queueMutation(task);
    } else {
      await task();
    }

    return { ok: true, flushed: true, reason };
  }

  function discardPendingAttention(reason = "discarded") {
    const discarded = volatileAttentionState !== null;
    volatileAttentionState = null;
    attentionStateEpoch += 1;
    globalThis.ZeroLatencyDebugEvents?.record?.("scheduler.attention.pending-discarded", {
      reason,
      discarded,
    });
    return discarded;
  }

  function shouldPersistAttentionObservation(result, observation, options) {
    return (
      Number(result?.recordedDurationMs) > 0 ||
      options?.persist === true ||
      isAttentionLifecycleBoundaryReason(observation?.reason)
    );
  }

  function isAttentionLifecycleBoundaryReason(reason) {
    return ATTENTION_LIFECYCLE_BOUNDARY_REASONS.has(String(reason || ""));
  }

  function applyVolatileAttentionState(preloadState) {
    if (!volatileAttentionState) {
      return preloadState;
    }

    preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
    preloadState.scheduler.attentionPool = volatileAttentionState.attentionPool;
    preloadState.scheduler.attentionPendingByKey =
      volatileAttentionState.attentionPendingByKey;
    preloadState.scheduler.activeTabCursor = volatileAttentionState.activeTabCursor;
    preloadState.scheduler.updatedAt = volatileAttentionState.updatedAt;
    preloadState.updatedAt = volatileAttentionState.updatedAt;
    return preloadState;
  }

  function captureVolatileAttentionState(preloadState) {
    const scheduler = normalizePreloadSchedulerState(preloadState?.scheduler);
    return {
      attentionPool: scheduler.attentionPool,
      attentionPendingByKey: scheduler.attentionPendingByKey,
      activeTabCursor: scheduler.activeTabCursor,
      updatedAt: scheduler.updatedAt,
    };
  }

  async function runPreloadAttentionMutation(task, options, getResult) {
    if (options?.queue === false) {
      await task();
      await notifyAttentionReschedule(getResult());
      return;
    }

    await queueMutation(task);
    await notifyAttentionReschedule(getResult());
  }

  globalThis.ZeroLatencyPreloadAttentionRuntimeMutation = {
    commitPreloadAttentionRuntimeObservation,
    pausePreloadAttentionCursorMutation,
    pausePreloadAttentionCursorIfMatchesMutation,
    flushPendingAttention,
    discardPendingAttention,
  };
})();
