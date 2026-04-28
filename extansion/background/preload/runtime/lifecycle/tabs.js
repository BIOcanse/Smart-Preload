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
    const entry = preloadTabEntry.sourceTabRuntime.hiddenTabEntriesByUrl?.[preloadTabEntry.url];

    if (entry) {
      if (expectedPreloadRemoval) {
        delete preloadTabEntry.sourceTabRuntime.hiddenTabEntriesByUrl[preloadTabEntry.url];
        preloadTabEntry.sourceTabRuntime.updatedAt = new Date().toISOString();
        preloadTabEntry.normalWindowRuntime.updatedAt = new Date().toISOString();
        preloadState.updatedAt = new Date().toISOString();
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
        preloadTabEntry.sourceTabRuntime.updatedAt = entry.updatedAt;
        preloadTabEntry.normalWindowRuntime.updatedAt = entry.updatedAt;
        preloadState.updatedAt = entry.updatedAt;
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

  const entry = preloadEntry.sourceTabRuntime.hiddenTabEntriesByUrl[preloadEntry.url];

  if (changeInfo.status) {
    entry.status = changeInfo.status;
  }

  if (tab?.url) {
    entry.loadedUrl = tab.url;
  }

  entry.updatedAt = new Date().toISOString();
  preloadEntry.sourceTabRuntime.updatedAt = entry.updatedAt;
  preloadEntry.normalWindowRuntime.updatedAt = entry.updatedAt;
  preloadState.updatedAt = entry.updatedAt;
  await savePreloadState(preloadState);
}
