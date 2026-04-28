async function requestPreloadCandidateRefreshForOpenTabs() {
  const preloadState = await loadPreloadState();
  const tabs = await chrome.tabs.query({
    windowType: "normal",
  });

  for (const tab of tabs) {
    if (!tab.id || !isTrackableAndAllowedUrl(tab.url || "") || isPreloadTab(preloadState, tab.id)) {
      continue;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "preload:collect-candidates",
      });
    } catch (_error) {
      // Some pages may not have an active content script or may reject messaging.
    }
  }
}
