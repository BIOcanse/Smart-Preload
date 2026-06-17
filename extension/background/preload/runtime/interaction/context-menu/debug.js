function buildContextMenuPreloadMissDebug(preloadState, { sourceTab, targetUrl }) {
  const sourceRuntime = getSourceTabRuntimeForWindow(
    preloadState,
    sourceTab?.windowId,
    sourceTab?.id
  )?.sourceTabRuntime;
  const hiddenEntries = getSourceTabPreloadChannelStore(sourceRuntime, "hiddenTab");

  return {
    sourceTabId: sourceTab?.id ?? null,
    sourceWindowId: sourceTab?.windowId ?? null,
    targetUrl,
    hiddenEntryCount: Object.keys(hiddenEntries).length,
    hasExactEntry: Boolean(hiddenEntries[targetUrl]),
    hiddenEntryUrls: Object.keys(hiddenEntries).slice(0, 12),
    exactEntryTrigger: hiddenEntries[targetUrl]?.interactionPreload?.trigger ?? null,
    exactEntryStatus: hiddenEntries[targetUrl]?.status ?? null,
    exactEntryTabId: hiddenEntries[targetUrl]?.tabId ?? null,
  };
}

globalThis.ZeroLatencyContextMenuPreloadDebug = {
  buildContextMenuPreloadMissDebug,
};
