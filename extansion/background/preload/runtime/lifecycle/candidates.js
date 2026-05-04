async function requestPreloadCandidateRefreshForOpenTabs() {
  const preloadState = await loadPreloadState();
  const tabs = await chrome.tabs.query({
    windowType: "normal",
    active: true,
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

async function requestPreloadCandidateRefreshForTab(tabId) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    return;
  }

  const preloadState = await loadPreloadState();
  const tab = await getTabMaybe(normalizedTabId);

  if (
    !tab?.id ||
    tab.active !== true ||
    !isTrackableAndAllowedUrl(tab.url || "") ||
    isPreloadTab(preloadState, tab.id)
  ) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "preload:collect-candidates",
    });
  } catch (_error) {
    // Some pages may not have an active content script or may reject messaging.
  }
}
