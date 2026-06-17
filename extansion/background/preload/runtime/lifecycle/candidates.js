async function requestPreloadCandidateRefreshForOpenTabs() {
  let preloadState = await loadPreloadState();
  const runtimeSettings = getEffectiveExtensionSettings();
  const tabs = await chrome.tabs.query({
    windowType: "normal",
  });
  const cleanup = await clearPreloadCandidateRefreshExclusionsForOpenTabs(
    preloadState,
    runtimeSettings,
    tabs
  );

  if (cleanup.mutated) {
    preloadState = cleanup.preloadState;
    await savePreloadState(preloadState);
  }

  for (const tab of tabs) {
    if (shouldSkipPreloadCandidateRefreshForTab(tab, preloadState, runtimeSettings)) {
      continue;
    }

    try {
      await sendPreloadCandidateCollectionMessage(tab.id, "open-tabs");
    } catch (error) {
      // Some pages may not have an active content script or may reject messaging.
      scheduleIndependentBackgroundPreloadCandidateRefreshForTab(
        tab,
        "open-tabs-message-failed",
        error
      );
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
  const runtimeSettings = getEffectiveExtensionSettings();

  if (shouldSkipPreloadCandidateRefreshForTab(tab, preloadState, runtimeSettings)) {
    const cleanup = await clearPreloadCandidateRefreshExclusionsForTab(
      preloadState,
      tab,
      runtimeSettings
    );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }
    return;
  }

  try {
    await sendPreloadCandidateCollectionMessage(tab.id, "single-tab");
  } catch (error) {
    // Some pages may not have an active content script or may reject messaging.
    scheduleIndependentBackgroundPreloadCandidateRefreshForTab(
      tab,
      "single-tab-message-failed",
      error
    );
  }
}
