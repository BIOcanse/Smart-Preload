const PRELOADED_TAB_ACTIVATION_POLL_MS = 75;

async function resolveActivatablePreloadedEntry({
  normalWindowId,
  sourceTabId,
  targetUrl,
  waitForReadyMs = 0,
}) {
  const deadline = Date.now() + Math.max(0, Number(waitForReadyMs) || 0);

  while (true) {
    const preloadState = await loadPreloadState();
    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      normalWindowId,
      sourceTabId
    );
    const entry = getSourceTabPreloadEntry(
      sourceRuntimeEntry?.sourceTabRuntime,
      "hiddenTab",
      targetUrl
    );
    const preloadedTab = entry?.tabId ? await getTabMaybe(entry.tabId) : null;
    const resolvedStatus = preloadedTab?.status || entry?.status || null;

    if (entry && preloadedTab) {
      entry.status = resolvedStatus;
      entry.loadedUrl = preloadedTab.url || entry.loadedUrl;
      entry.updatedAt = new Date().toISOString();
      markSourceTabPreloadChannelsUpdated(preloadState, sourceRuntimeEntry, entry.updatedAt);
    }

    if (!entry) {
      if (Date.now() >= deadline) {
        return {
          preloadState,
          sourceRuntimeEntry: null,
          entry: null,
          preloadedTab: null,
        };
      }
    } else if (!preloadedTab || resolvedStatus === "complete") {
      return {
        preloadState,
        sourceRuntimeEntry,
        entry,
        preloadedTab,
      };
    } else if (Date.now() >= deadline) {
      return {
        preloadState,
        sourceRuntimeEntry,
        entry,
        preloadedTab,
      };
    }

    await sleepPreloadedActivationPoll();
  }
}

async function sleepPreloadedActivationPoll() {
  await new Promise((resolve) => {
    setTimeout(resolve, PRELOADED_TAB_ACTIVATION_POLL_MS);
  });
}
