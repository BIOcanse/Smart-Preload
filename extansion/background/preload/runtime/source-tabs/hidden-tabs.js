async function synchronizePreloadsForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
  return globalThis.ZeroLatencyHiddenTabPreloadDiff.syncTargets(
    preloadState,
    normalWindowId,
    sourceTabId,
    targets
  );
}

async function clearPreloadsForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  options = {}
) {
  const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    normalWindowId,
    sourceTabId
  );

  if (!sourceRuntimeEntry) {
    return preloadState;
  }

  const keepTabIds = new Set(options.keepTabIds || []);

  for (const entry of Object.values(
    getSourceTabPreloadChannelStore(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab")
  )) {
    if (keepTabIds.has(entry.tabId)) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
  }

  clearSourceTabPreloadChannelStores(sourceRuntimeEntry.sourceTabRuntime);
  markSourceTabPreloadChannelsUpdated(preloadState, sourceRuntimeEntry);
  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  return preloadState;
}
