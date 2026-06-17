async function shouldSkipNavigationForExcludedSourceTab(tabId, reason) {
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
    globalThis.ZeroLatencyDebugEvents?.record?.("navigation.skip-incognito-source", {
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

  globalThis.ZeroLatencyDebugEvents?.record?.("navigation.skip-proxy-source", {
    tabId: normalizedTabId,
    windowId: tab?.windowId ?? null,
    url: tab?.url || "",
    reason,
  });
  return true;
}
