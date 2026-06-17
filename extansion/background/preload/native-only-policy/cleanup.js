async function clearHiddenTabPreloadStateForNativeOnlyMode(
  preloadState,
  settings = resolveCurrentNativeOnlySettings(),
  options = {}
) {
  if (!isAllNativePreloadModeEnabled(settings)) {
    return {
      preloadState,
      mutated: false,
      closedTabIds: [],
      closedWindowIds: [],
    };
  }

  const closedTabIds = [];
  const closedWindowIds = [];
  let mutated = false;

  for (const [normalWindowId, normalWindowRuntime] of Object.entries(
    preloadState?.normalWindowsById || {}
  )) {
    for (const [sourceTabId, sourceTabRuntime] of Object.entries(
      normalWindowRuntime?.sourceTabs || {}
    )) {
      const hiddenEntries = sourceTabRuntime?.hiddenTabEntriesByUrl || {};

      for (const entry of Object.values(hiddenEntries)) {
        if (entry?.tabId != null) {
          await closeTabIfExists(entry.tabId);
          closedTabIds.push(entry.tabId);
        }
      }

      if (Object.keys(hiddenEntries).length > 0) {
        sourceTabRuntime.hiddenTabEntriesByUrl = {};
        sourceTabRuntime.updatedAt = new Date().toISOString();
        normalWindowRuntime.updatedAt = sourceTabRuntime.updatedAt;
        mutated = true;
        globalThis.ZeroLatencyDebugEvents?.record?.("native-only.hidden-tabs.clear-source", {
          normalWindowId,
          sourceTabId,
          reason: options.reason || "native-only-mode",
        });
      }

      pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
    }

    const preloadWindowId = normalizePositiveInteger(
      normalWindowRuntime?.preloadWindow?.windowId
    );

    if (preloadWindowId !== null) {
      const closed =
        await globalThis.ZeroLatencyPreloadWindowManager?.closeWindowForNormalWindow?.(
          preloadState,
          normalWindowId
        );

      if (closed) {
        closedWindowIds.push(preloadWindowId);
        mutated = true;
      }
    }

    pruneNormalWindowRuntime(preloadState, normalWindowId);
  }

  if (mutated) {
    preloadState.updatedAt = new Date().toISOString();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-only.hidden-tabs.clear", {
      closedTabCount: closedTabIds.length,
      closedWindowCount: closedWindowIds.length,
      reason: options.reason || "native-only-mode",
    });
  }

  return {
    preloadState,
    mutated,
    closedTabIds,
    closedWindowIds,
  };
}
