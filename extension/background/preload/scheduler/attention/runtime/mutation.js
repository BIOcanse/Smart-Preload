(function () {
  const {
    buildPreloadAttentionRuntimeOptions,
  } = globalThis.ZeroLatencyPreloadAttentionActivity;
  const {
    recordPreloadAttentionObservationAndMaybeReschedule,
    notifyAttentionReschedule,
  } = globalThis.ZeroLatencyPreloadAttentionObservation;

  async function commitPreloadAttentionRuntimeObservation({
    observation,
    runtimeOptions,
    options = {},
    skipPreloadTabId = null,
  }) {
    let result = null;
    const normalizedSkipTabId = normalizePositiveInteger(skipPreloadTabId);
    const task = async () => {
      const preloadState = await loadPreloadState();

      if (normalizedSkipTabId !== null && isPreloadTab(preloadState, normalizedSkipTabId)) {
        return;
      }

      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        observation,
        runtimeOptions
      );

      await savePreloadState(result.preloadState);
    };

    await runPreloadAttentionMutation(task, options, () => result);
  }

  async function pausePreloadAttentionCursorMutation(reason = "pause", options = {}) {
    let result = null;
    const task = async () => {
      const preloadState = await loadPreloadState();
      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          observedAt: new Date().toISOString(),
          counting: false,
          reason,
        },
        buildPreloadAttentionRuntimeOptions(options)
      );

      await savePreloadState(result.preloadState);
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
      const preloadState = await loadPreloadState();
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

      await savePreloadState(result.preloadState);
    };

    await runPreloadAttentionMutation(task, options, () => result);
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
  };
})();
