async function closeHiddenTabsForResourcePressure(
  preloadState,
  normalWindowId,
  normalWindowRuntime,
  preloadWindowManager
) {
  const updatedAt = new Date().toISOString();
  let didMutate = false;

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    let didTouchSource = false;

    for (const entry of Object.values(
      getSourceTabPreloadChannelStore(sourceTabRuntime, "hiddenTab")
    )) {
      if (
        entry.tabId !== null ||
        entry.loadedUrl !== null ||
        entry.status !== "closed-resource-pressure"
      ) {
        if (Number.isFinite(entry.tabId)) {
          globalThis.clearKnownPreloadTab?.(entry.tabId);
        }

        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "closed-resource-pressure";
        entry.updatedAt = updatedAt;
        didTouchSource = true;
        didMutate = true;
      }
    }

    if (didTouchSource) {
      sourceTabRuntime.updatedAt = updatedAt;
    }
  }

  if (didMutate) {
    normalWindowRuntime.updatedAt = updatedAt;
    preloadState.updatedAt = updatedAt;
  }

  if (await preloadWindowManager?.closeWindowForNormalWindow?.(preloadState, normalWindowId)) {
    didMutate = true;
  }

  if (didMutate) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.close", {
      normalWindowId,
    });
  }

  return didMutate;
}

async function sleepHiddenTabsForResourcePressure(
  preloadState,
  normalWindowId,
  normalWindowRuntime,
  preloadWindowManager
) {
  if (!hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime)) {
    return Boolean(
      await preloadWindowManager?.closeWindowForNormalWindow?.(preloadState, normalWindowId)
    );
  }

  const canDiscardTabs =
    globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "discard") === true;
  const updatedAt = new Date().toISOString();
  let didMutate = false;
  let sleptTabCount = 0;

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    let didTouchSource = false;

    for (const entry of Object.values(
      getSourceTabPreloadChannelStore(sourceTabRuntime, "hiddenTab")
    )) {
      const tabId = normalizePositiveInteger(entry.tabId);

      if (tabId === null) {
        continue;
      }

      const liveTab = await getTabMaybe(tabId);

      if (!liveTab) {
        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "missing-resource-pressure";
        entry.updatedAt = updatedAt;
        didTouchSource = true;
        didMutate = true;
        continue;
      }

      if (liveTab.discarded === true && entry.status === "sleeping-resource-pressure") {
        continue;
      }

      try {
        await chrome.tabs.update(tabId, { autoDiscardable: true });
      } catch (_error) {
        // Older Chromium builds may reject autoDiscardable updates.
      }

      let discardedTab = null;

      if (canDiscardTabs) {
        try {
          discardedTab = await chrome.tabs.discard(tabId);
          sleptTabCount += 1;
        } catch (error) {
          globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.sleep.error", {
            normalWindowId,
            tabId,
            error: String(error?.message || error),
          });
        }
      }

      entry.loadedUrl = discardedTab?.url || liveTab.url || entry.loadedUrl;
      entry.status = canDiscardTabs
        ? "sleeping-resource-pressure"
        : "sleep-unsupported-resource-pressure";
      entry.updatedAt = updatedAt;
      didTouchSource = true;
      didMutate = true;
    }

    if (didTouchSource) {
      sourceTabRuntime.updatedAt = updatedAt;
    }
  }

  if (didMutate) {
    normalWindowRuntime.updatedAt = updatedAt;
    preloadState.updatedAt = updatedAt;
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.sleep", {
      normalWindowId,
      canDiscardTabs,
      sleptTabCount,
    });
  }

  return didMutate;
}
