async function clearStaleActivationEntry({
  preloadState,
  sourceRuntimeEntry,
  sourceTab,
  sourceTabId,
  targetUrl,
  entry,
}) {
  delete sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl[targetUrl];
  pruneSourceTabRuntime(preloadState, sourceTab.windowId, sourceTabId);
  await savePreloadState(preloadState);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.stale-entry", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl,
    entryTabId: entry?.tabId ?? null,
  });
}

async function clearSourceTabPreloadsAfterActivation({
  preloadState,
  sourceTab,
  sourceTabId,
  activatedTab,
}) {
  const nextPreloadState = await clearPreloadsForSourceTab(
    preloadState,
    sourceTab.windowId,
    sourceTabId,
    {
      keepTabIds: [activatedTab.id],
    }
  );
  await savePreloadState(nextPreloadState);
  return nextPreloadState;
}
