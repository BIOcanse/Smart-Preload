async function closePreloadWindowForNormalWindow(preloadState, normalWindowId) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return false;
  }

  const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);
  const preloadWindowId = normalWindowRuntime?.preloadWindow?.windowId;

  if (!Number.isFinite(preloadWindowId)) {
    return false;
  }

  try {
    await chrome.windows.remove(preloadWindowId);
  } catch (_error) {
    // The preload window may already be gone.
  }

  globalThis.clearKnownPreloadWindow?.(preloadWindowId);
  const closedAt = new Date().toISOString();
  resetPreloadWindowState(normalWindowRuntime.preloadWindow);
  normalWindowRuntime.preloadWindow.updatedAt = closedAt;
  normalWindowRuntime.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
  preloadState.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
  return true;
}

async function closeHiddenTabsForNormalWindowRuntime(normalWindowRuntime) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    for (const entry of Object.values(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
      await closeTabIfExists(entry.tabId);
    }
  }
}

async function cleanupErroneousPreloadWindows(preloadState) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return false;
  }

  const expectedWindowIds = new Set();
  const trackedPreloadTabIds = new Set();

  for (const normalWindowRuntime of Object.values(preloadState.normalWindowsById || {})) {
    if (Number.isFinite(normalWindowRuntime?.preloadWindow?.windowId)) {
      expectedWindowIds.add(normalWindowRuntime.preloadWindow.windowId);
    }

    for (const sourceTabRuntime of Object.values(normalWindowRuntime?.sourceTabs || {})) {
      for (const entry of Object.values(sourceTabRuntime?.hiddenTabEntriesByUrl || {})) {
        if (Number.isFinite(entry?.tabId)) {
          trackedPreloadTabIds.add(entry.tabId);
        }
      }
    }
  }

  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
  let didCloseAnyWindow = false;

  for (const window of windows) {
    if (!Number.isFinite(window.id) || expectedWindowIds.has(window.id)) {
      continue;
    }

    const tabs = Array.isArray(window.tabs) ? window.tabs : [];

    if (!tabs.length) {
      continue;
    }

    const hasTrackedPreloadTab = tabs.some(
      (tab) => Number.isFinite(tab?.id) && trackedPreloadTabIds.has(tab.id)
    );
    const hasSentinelTab = tabs.some(
      (tab) => typeof tab?.url === "string" && tab.url === PRELOAD_WINDOW_SENTINEL_URL
    );
    // A window containing our sentinel URL is extension-owned even if stale state lost
    // the preloaded tab ids. Close it during reset/cleanup instead of leaving it visible.
    if (!hasTrackedPreloadTab && !hasSentinelTab) {
      continue;
    }

    try {
      await chrome.windows.remove(window.id);
      didCloseAnyWindow = true;
    } catch (_error) {
      // The erroneous window may already be gone.
    }
  }

  return didCloseAnyWindow;
}

async function runErroneousPreloadWindowCleanup() {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  if (await isExtensionServicePaused()) {
    return;
  }

  const preloadState = await loadPreloadState();

  if (await cleanupErroneousPreloadWindows(preloadState)) {
    await savePreloadState(preloadState);
  }
}
