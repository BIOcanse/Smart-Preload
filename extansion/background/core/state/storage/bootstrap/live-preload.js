(function () {
  async function sanitizeLivePreloadStateForBackgroundState(preloadState) {
    // Stored Chrome window/tab ids cannot be trusted across browser restarts or profile
    // switches. Validate every preload runtime against live tabs before any watchdog can hide it.
    const nextPreloadState = normalizePreloadState(preloadState);
    const liveWindows = await chrome.windows.getAll({
      windowTypes: ["normal"],
      populate: true,
    });
    const liveWindowsById = new Map(liveWindows.map((window) => [window.id, window]));
    const liveTabsById = new Map();

    for (const liveWindow of liveWindows) {
      for (const tab of liveWindow.tabs || []) {
        liveTabsById.set(tab.id, tab);
      }
    }

    for (const [normalWindowId, normalWindowRuntime] of Object.entries(
      nextPreloadState.normalWindowsById || {}
    )) {
      const liveNormalWindow = liveWindowsById.get(normalWindowRuntime.normalWindowId);

      if (!liveNormalWindow) {
        delete nextPreloadState.normalWindowsById[normalWindowId];
        continue;
      }

      pruneSourceTabRuntimesAgainstLiveTabs(normalWindowRuntime, liveTabsById);

      if (!livePreloadWindowMatchesRuntime(normalWindowRuntime, liveWindowsById, liveTabsById)) {
        resetPreloadWindowState(normalWindowRuntime.preloadWindow);
      }

      if (
        Object.keys(normalWindowRuntime.sourceTabs || {}).length === 0 &&
        normalizePositiveInteger(normalWindowRuntime.preloadWindow?.windowId) === null
      ) {
        delete nextPreloadState.normalWindowsById[normalWindowId];
      }
    }

    await closeOrphanSentinelPreloadWindows(liveWindows, nextPreloadState);
    return nextPreloadState;
  }

  function pruneSourceTabRuntimesAgainstLiveTabs(normalWindowRuntime, liveTabsById) {
    for (const [sourceTabId, sourceTabRuntime] of Object.entries(
      normalWindowRuntime.sourceTabs || {}
    )) {
      const liveSourceTab = liveTabsById.get(sourceTabRuntime.sourceTabId);

      if (!liveSourceTab || liveSourceTab.windowId !== normalWindowRuntime.normalWindowId) {
        delete normalWindowRuntime.sourceTabs[sourceTabId];
        continue;
      }

      for (const [url, entry] of Object.entries(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
        const livePreloadTab = liveTabsById.get(entry.tabId);

        if (!livePreloadTab || !preloadEntryMatchesLiveTabForBootstrap(entry, livePreloadTab)) {
          delete sourceTabRuntime.hiddenTabEntriesByUrl[url];
        }
      }
    }
  }

  function livePreloadWindowMatchesRuntime(normalWindowRuntime, liveWindowsById, liveTabsById) {
    const preloadWindowId = normalizePositiveInteger(normalWindowRuntime.preloadWindow?.windowId);

    if (preloadWindowId === null) {
      return false;
    }

    const livePreloadWindow = liveWindowsById.get(preloadWindowId);

    if (!livePreloadWindow) {
      return false;
    }

    if ((livePreloadWindow.tabs || []).some((tab) => tab.url === PRELOAD_WINDOW_SENTINEL_URL)) {
      return true;
    }

    return Object.values(normalWindowRuntime.sourceTabs || {}).some((sourceTabRuntime) =>
      Object.values(sourceTabRuntime.hiddenTabEntriesByUrl || {}).some((entry) => {
        const livePreloadTab = liveTabsById.get(entry.tabId);

        return (
          livePreloadTab?.windowId === preloadWindowId &&
          preloadEntryMatchesLiveTabForBootstrap(entry, livePreloadTab)
        );
      })
    );
  }

  function preloadEntryMatchesLiveTabForBootstrap(entry, liveTab) {
    const liveUrl = normalizePageUrlForIndex(liveTab?.url || "");
    const requestedUrl = normalizePageUrlForIndex(entry?.requestedUrl || "");
    const loadedUrl = normalizePageUrlForIndex(entry?.loadedUrl || "");

    return Boolean(
      liveUrl &&
        ((requestedUrl && liveUrl === requestedUrl) || (loadedUrl && liveUrl === loadedUrl))
    );
  }

  async function closeOrphanSentinelPreloadWindows(liveWindows, preloadState) {
    const trackedPreloadWindowIds = new Set(
      Object.values(preloadState.normalWindowsById || {})
        .map((normalWindowRuntime) =>
          normalizePositiveInteger(normalWindowRuntime?.preloadWindow?.windowId)
        )
        .filter((windowId) => windowId !== null)
    );

    for (const liveWindow of liveWindows) {
      const hasSentinelTab = (liveWindow.tabs || []).some(
        (tab) => tab.url === PRELOAD_WINDOW_SENTINEL_URL
      );

      if (!hasSentinelTab || trackedPreloadWindowIds.has(liveWindow.id)) {
        continue;
      }

      try {
        await chrome.windows.remove(liveWindow.id);
      } catch (_error) {
        // Orphan cleanup is best-effort; normal prediction can recreate a clean window later.
      }
    }
  }

  globalThis.sanitizeLivePreloadStateForBackgroundState =
    sanitizeLivePreloadStateForBackgroundState;
})();
