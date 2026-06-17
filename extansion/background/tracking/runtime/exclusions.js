(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

  async function shouldSkipTrackingForExcludedSourceTab(tabId, reason) {
    const normalizedTabId = normalizePositiveInteger(tabId);

    if (normalizedTabId === null) {
      return false;
    }

    const tab = await getTabMaybe(normalizedTabId);

    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        tab,
        getEffectiveExtensionSettings()
      ) === true
    ) {
      globalThis.ZeroLatencyDebugEvents?.record?.("tracking.skip-incognito-source", {
        tabId: normalizedTabId,
        windowId: tab?.windowId ?? null,
        url: tab?.url || "",
        reason,
      });
      return true;
    }

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        tab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("tracking.skip-proxy-source", {
      tabId: normalizedTabId,
      windowId: tab?.windowId ?? null,
      url: tab?.url || "",
      reason,
    });
    return true;
  }

  runtime.shouldSkipTrackingForExcludedSourceTab = shouldSkipTrackingForExcludedSourceTab;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
