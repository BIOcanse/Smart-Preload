(function () {
  function load() {
    return loadPreloadState();
  }

  function save(preloadState) {
    return savePreloadState(preloadState);
  }

  function getNormalWindow(preloadState, normalWindowId) {
    return getNormalWindowRuntime(preloadState, normalWindowId);
  }

  function ensureNormalWindow(preloadState, normalWindowId) {
    return ensureNormalWindowRuntime(preloadState, normalWindowId);
  }

  function getSourceTab(preloadState, normalWindowId, sourceTabId) {
    return getSourceTabRuntimeForWindow(preloadState, normalWindowId, sourceTabId);
  }

  function ensureSourceTab(preloadState, normalWindowId, sourceTabId) {
    return ensureSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  }

  function findSourceTab(preloadState, sourceTabId) {
    return findSourceTabRuntime(preloadState, sourceTabId);
  }

  function findPreloadEntryByChromeTabId(preloadState, tabId) {
    return findPreloadEntryByTabId(preloadState, tabId);
  }

  function isKnownPreloadWindowId(preloadState, windowId) {
    return isPreloadWindowId(preloadState, windowId);
  }

  function isKnownPreloadTabId(preloadState, tabId) {
    return isPreloadTab(preloadState, tabId);
  }

  function pruneNormalWindow(preloadState, normalWindowId) {
    return pruneNormalWindowRuntime(preloadState, normalWindowId);
  }

  function pruneSourceTab(preloadState, normalWindowId, sourceTabId) {
    return pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  }

  function markPreloadWindow(windowId) {
    return globalThis.markKnownPreloadWindow?.(windowId);
  }

  function clearPreloadWindow(windowId) {
    return globalThis.clearKnownPreloadWindow?.(windowId);
  }

  function markPreloadTab(tabId) {
    return globalThis.markKnownPreloadTab?.(tabId);
  }

  function clearPreloadTab(tabId) {
    return globalThis.clearKnownPreloadTab?.(tabId);
  }

  globalThis.ZeroLatencyPreloadRegistry = {
    load,
    save,
    getNormalWindow,
    ensureNormalWindow,
    getSourceTab,
    ensureSourceTab,
    findSourceTab,
    findPreloadEntryByChromeTabId,
    isKnownPreloadWindowId,
    isKnownPreloadTabId,
    pruneNormalWindow,
    pruneSourceTab,
    markPreloadWindow,
    clearPreloadWindow,
    markPreloadTab,
    clearPreloadTab,
  };
})();
