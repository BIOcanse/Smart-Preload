(function () {
  async function hydrateBookmarkPreloadingServiceStateForBackgroundState(
    preloadState,
    currentBookmarkState
  ) {
    const normalizedBookmarkState = normalizeBookmarkPreloadingServiceState(
      currentBookmarkState
    );
    const tabs = await chrome.tabs.query({
      windowType: "normal",
    });
    const liveStartupTab = tabs.find(
      (tab) =>
        tab.id === normalizedBookmarkState.startupGoogleSearchTabId &&
        tab.windowId === normalizedBookmarkState.startupGoogleSearchWindowId &&
        !isPreloadWindowId(preloadState, tab.windowId) &&
        isGoogleSearchPageForBookmarkPreload(tab.url || "")
    );

    if (liveStartupTab) {
      return normalizedBookmarkState;
    }

    const startupGoogleSearchTab = tabs.find(
      (tab) =>
        tab.id &&
        tab.windowId &&
        !isPreloadWindowId(preloadState, tab.windowId) &&
        isGoogleSearchPageForBookmarkPreload(tab.url || "")
    );

    if (!startupGoogleSearchTab) {
      return {
        startupGoogleSearchTabId: null,
        startupGoogleSearchWindowId: null,
      };
    }

    return {
      startupGoogleSearchTabId: startupGoogleSearchTab.id,
      startupGoogleSearchWindowId: startupGoogleSearchTab.windowId,
    };
  }

  async function hydrateTabStateFromOpenTabsForBackgroundState(preloadState) {
    const nextTabState = {};
    const tabs = await chrome.tabs.query({
      windowType: "normal",
    });
    const updatedAt = new Date().toISOString();

    for (const tab of tabs) {
      if (!tab.id || !isTrackableAndAllowedUrl(tab.url || "")) {
        continue;
      }

      if (isPreloadWindowId(preloadState, tab.windowId)) {
        continue;
      }

      nextTabState[String(tab.id)] = {
        nodeId: buildNodeSeed(tab.url).nodeId,
        url: tab.url,
        updatedAt,
      };
    }

    return nextTabState;
  }

  globalThis.hydrateTabStateFromOpenTabsForBackgroundState =
    hydrateTabStateFromOpenTabsForBackgroundState;
  globalThis.hydrateBookmarkPreloadingServiceStateForBackgroundState =
    hydrateBookmarkPreloadingServiceStateForBackgroundState;
})();
