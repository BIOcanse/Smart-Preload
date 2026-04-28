(function () {
  const knownPreloadWindowIds = new Set();
  const knownPreloadTabIds = new Set();

  function normalizePositiveInteger(value) {
    const numericValue = Number(value);

    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
  }

  function markKnownPreloadWindow(windowId) {
    const normalizedWindowId = normalizePositiveInteger(windowId);

    if (normalizedWindowId !== null) {
      knownPreloadWindowIds.add(normalizedWindowId);
    }
  }

  function clearKnownPreloadWindow(windowId) {
    const normalizedWindowId = normalizePositiveInteger(windowId);

    if (normalizedWindowId !== null) {
      knownPreloadWindowIds.delete(normalizedWindowId);
    }
  }

  function markKnownPreloadTab(tabId, options = {}) {
    const normalizedTabId = normalizePositiveInteger(tabId);

    if (normalizedTabId !== null) {
      knownPreloadTabIds.add(normalizedTabId);
    }

    if (options?.windowId !== undefined) {
      markKnownPreloadWindow(options.windowId);
    }
  }

  function clearKnownPreloadTab(tabId) {
    const normalizedTabId = normalizePositiveInteger(tabId);

    if (normalizedTabId !== null) {
      knownPreloadTabIds.delete(normalizedTabId);
    }
  }

  function isKnownPreloadContext(tabId, windowId) {
    const normalizedTabId = normalizePositiveInteger(tabId);
    const normalizedWindowId = normalizePositiveInteger(windowId);

    return (
      (normalizedTabId !== null && knownPreloadTabIds.has(normalizedTabId)) ||
      (normalizedWindowId !== null && knownPreloadWindowIds.has(normalizedWindowId))
    );
  }

  function clearKnownPreloadRuntime() {
    knownPreloadWindowIds.clear();
    knownPreloadTabIds.clear();
  }

  function snapshotKnownPreloadRuntime() {
    return {
      windowIds: Array.from(knownPreloadWindowIds.values()),
      tabIds: Array.from(knownPreloadTabIds.values()),
    };
  }

  globalThis.markKnownPreloadWindow = markKnownPreloadWindow;
  globalThis.clearKnownPreloadWindow = clearKnownPreloadWindow;
  globalThis.markKnownPreloadTab = markKnownPreloadTab;
  globalThis.clearKnownPreloadTab = clearKnownPreloadTab;
  globalThis.isKnownPreloadContext = isKnownPreloadContext;
  globalThis.clearKnownPreloadRuntime = clearKnownPreloadRuntime;
  globalThis.snapshotKnownPreloadRuntime = snapshotKnownPreloadRuntime;
})();
