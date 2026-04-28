async function repairPreloadEntries(preloadState, normalWindowId, preloadWindowId) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return false;
  }

  const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

  if (!normalWindowRuntime) {
    return false;
  }

  let didMutate = false;
  const sourceTabIds = Object.keys(normalWindowRuntime.sourceTabs || {});

  for (const sourceTabId of sourceTabIds) {
    const sourceTab = await getTabMaybe(Number(sourceTabId));

    if (!sourceTab) {
      await clearPreloadsForSourceTab(preloadState, normalWindowId, sourceTabId);
      didMutate = true;
      continue;
    }

    const sourceWindow = await getWindowMaybe(sourceTab.windowId);

    if (
      !sourceWindow ||
      sourceWindow.type !== "normal" ||
      sourceWindow.id !== Number(normalWindowId)
    ) {
      await clearPreloadsForSourceTab(preloadState, normalWindowId, sourceTabId);
      didMutate = true;
      continue;
    }

    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      normalWindowId,
      sourceTabId
    );

    if (!sourceRuntimeEntry) {
      continue;
    }

    for (const entry of Object.values(sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl)) {
      const liveTab = entry.tabId ? await getTabMaybe(entry.tabId) : null;

      if (!liveTab) {
        await primePreloadEntry(preloadWindowId, entry);
        didMutate = true;
        continue;
      }

      if (liveTab.windowId !== preloadWindowId) {
        try {
          await chrome.tabs.move(liveTab.id, {
            windowId: preloadWindowId,
            index: -1,
          });
          await chrome.tabs.update(liveTab.id, { active: false });

          try {
            await chrome.tabs.update(liveTab.id, { autoDiscardable: false });
          } catch (_error) {
            // Older Chrome builds may reject autoDiscardable updates.
          }

          entry.tabId = liveTab.id;
          globalThis.markKnownPreloadWindow?.(preloadWindowId);
          globalThis.markKnownPreloadTab?.(liveTab.id, { windowId: preloadWindowId });
        } catch (_error) {
          await closeTabIfExists(liveTab.id);
          await primePreloadEntry(preloadWindowId, entry);
        }

        didMutate = true;
      }

      entry.loadedUrl = liveTab.url || entry.loadedUrl;
      entry.status = liveTab.status || entry.status;
      entry.updatedAt = new Date().toISOString();
      sourceRuntimeEntry.sourceTabRuntime.updatedAt = entry.updatedAt;
      sourceRuntimeEntry.normalWindowRuntime.updatedAt = entry.updatedAt;
      preloadState.updatedAt = entry.updatedAt;
    }
  }

  return didMutate;
}
