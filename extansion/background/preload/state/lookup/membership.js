(function () {
  function findPreloadEntryByTabId(preloadState, tabId) {
    const targetTabId = Number(tabId);

    for (const [normalWindowId, normalWindowRuntime] of Object.entries(preloadState.normalWindowsById || {})) {
      for (const [sourceTabId, sourceTabRuntime] of Object.entries(normalWindowRuntime.sourceTabs || {})) {
        for (const [url, entry] of Object.entries(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
          if (entry.tabId === targetTabId) {
            return {
              normalWindowId,
              normalWindowRuntime,
              sourceTabId,
              sourceTabRuntime,
              url,
              entry,
            };
          }
        }
      }
    }

    return null;
  }

  function isPreloadWindowId(preloadState, windowId) {
    return findNormalWindowRuntimeByPreloadWindowId(preloadState, windowId) !== null;
  }

  function isPreloadTab(preloadState, tabId) {
    return findPreloadEntryByTabId(preloadState, tabId) !== null;
  }

  globalThis.findPreloadEntryByTabId = findPreloadEntryByTabId;
  globalThis.isPreloadWindowId = isPreloadWindowId;
  globalThis.isPreloadTab = isPreloadTab;
})();
