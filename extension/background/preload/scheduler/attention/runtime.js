(function () {
  const {
    resolveActiveTabAttentionObservation,
  } = globalThis.ZeroLatencyPreloadAttentionRuntimeSource;
  const {
    commitPreloadAttentionRuntimeObservation,
    pausePreloadAttentionCursorMutation,
    pausePreloadAttentionCursorIfMatchesMutation,
  } = globalThis.ZeroLatencyPreloadAttentionRuntimeMutation;

  async function recordActiveTabAttentionFromActiveInfo(
    activeInfo,
    reason = "tab-activated",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(activeInfo?.tabId);

    if (tabId === null) {
      return;
    }

    const tab = await getTabMaybe(tabId);
    await recordActiveTabAttentionFromTab(tab, reason, options);
  }

  async function recordActiveTabAttentionFromSender(
    sender,
    reason = "content-activity",
    options = {}
  ) {
    const senderTabId = normalizePositiveInteger(sender?.tab?.id);

    if (
      options?.coalesce !== false &&
      senderTabId !== null &&
      typeof globalThis.queueAttention === "function"
    ) {
      return globalThis.queueAttention(`attention-runtime:${senderTabId}`, () =>
        recordActiveTabAttentionFromSenderNow(sender, reason, options)
      );
    }

    return recordActiveTabAttentionFromSenderNow(sender, reason, options);
  }

  async function recordActiveTabAttentionFromSenderNow(
    sender,
    reason,
    options
  ) {
    const senderTabId = normalizePositiveInteger(sender?.tab?.id);
    const liveTab = senderTabId === null ? null : await getTabMaybe(senderTabId);

    await recordActiveTabAttentionFromTab(
      liveTab
        ? {
            ...liveTab,
            url: sender?.tab?.url || liveTab.url || "",
          }
        : sender?.tab,
      reason,
      options
    );
  }

  async function recordActiveTabAttentionFromNavigationDetails(
    details,
    reason = "navigation",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(details?.tabId);

    if (tabId === null) {
      return;
    }

    const tab = await getTabMaybe(tabId);
    await recordActiveTabAttentionFromTab(
      {
        ...tab,
        url: details?.url || tab?.url || "",
      },
      reason,
      options
    );
  }

  async function recordActiveTabAttentionFromFocusedWindow(
    windowId,
    reason = "window-focus",
    options = {}
  ) {
    const normalizedWindowId = normalizePositiveInteger(windowId);

    if (normalizedWindowId === null) {
      await pausePreloadAttentionCursor(reason, options);
      return;
    }

    let activeTabs = [];

    try {
      activeTabs = await chrome.tabs.query({
        windowId: normalizedWindowId,
        active: true,
      });
    } catch (_error) {
      activeTabs = [];
    }

    await recordActiveTabAttentionFromTab(activeTabs[0] ?? null, reason, options);
  }

  function pausePreloadAttentionCursor(reason = "pause", options = {}) {
    return pausePreloadAttentionCursorMutation(reason, options);
  }

  function pausePreloadAttentionCursorIfMatches(
    match,
    reason = "pause-matched",
    options = {}
  ) {
    return pausePreloadAttentionCursorIfMatchesMutation(match, reason, options);
  }

  async function recordActiveTabAttentionFromTab(tab, reason = "active-tab", options = {}) {
    const resolved = await resolveActiveTabAttentionObservation(tab, reason, options);

    if (!resolved) {
      return;
    }

    await commitPreloadAttentionRuntimeObservation({
      observation: resolved.observation,
      runtimeOptions: resolved.runtimeOptions,
      options,
      skipPreloadTabId: resolved.tabId,
    });
  }

  globalThis.ZeroLatencyPreloadAttentionRuntime = {
    recordActiveTabAttentionFromActiveInfo,
    recordActiveTabAttentionFromSender,
    recordActiveTabAttentionFromNavigationDetails,
    recordActiveTabAttentionFromFocusedWindow,
    pausePreloadAttentionCursor,
    pausePreloadAttentionCursorIfMatches,
    flushPendingAttention:
      globalThis.ZeroLatencyPreloadAttentionRuntimeMutation.flushPendingAttention,
    discardPendingAttention:
      globalThis.ZeroLatencyPreloadAttentionRuntimeMutation.discardPendingAttention,
  };
})();
