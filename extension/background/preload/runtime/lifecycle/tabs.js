async function handleRemovedTab(tabId) {
  globalThis.clearKnownPreloadTab?.(tabId);
  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "remove-tab",
    tabId: String(tabId),
  });

  await saveTrackingState(nextTrackingState);

  let preloadState = await loadPreloadState();
  const preloadTabEntry = findPreloadEntryByTabId(preloadState, tabId);
  const expectedPreloadRemoval = consumeExpectedPreloadRemoval(tabId);

  if (preloadTabEntry) {
    const entry = getSourceTabPreloadEntry(
      preloadTabEntry.sourceTabRuntime,
      "hiddenTab",
      preloadTabEntry.url
    );

    if (entry) {
      if (expectedPreloadRemoval) {
        deleteSourceTabPreloadEntry(
          preloadTabEntry.sourceTabRuntime,
          "hiddenTab",
          preloadTabEntry.url
        );
        markSourceTabPreloadChannelsUpdated(preloadState, preloadTabEntry);
        pruneSourceTabRuntime(
          preloadState,
          preloadTabEntry.normalWindowId,
          preloadTabEntry.sourceTabId
        );
      } else {
        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "missing";
        entry.updatedAt = new Date().toISOString();
        markSourceTabPreloadChannelsUpdated(preloadState, preloadTabEntry, entry.updatedAt);
      }
    }
  }

  const sourceTabRuntimeEntry = findSourceTabRuntime(preloadState, String(tabId));

  if (sourceTabRuntimeEntry) {
    preloadState = await clearPreloadsForSourceTab(
      preloadState,
      sourceTabRuntimeEntry.normalWindowId,
      String(tabId)
    );
  }

  await savePreloadState(preloadState);
}

async function updatePreloadedTabStatus(tabId, changeInfo, tab) {
  const preloadState = await loadPreloadState();
  const preloadEntry = findPreloadEntryByTabId(preloadState, tabId);

  if (!preloadEntry) {
    return;
  }

  const entry = getSourceTabPreloadEntry(
    preloadEntry.sourceTabRuntime,
    "hiddenTab",
    preloadEntry.url
  );

  if (!entry) {
    return;
  }

  if (changeInfo.status) {
    entry.status = changeInfo.status;
  }

  if (tab?.url) {
    entry.loadedUrl = tab.url;
  }

  entry.updatedAt = new Date().toISOString();
  markSourceTabPreloadChannelsUpdated(preloadState, preloadEntry, entry.updatedAt);
  await savePreloadState(preloadState);
}
