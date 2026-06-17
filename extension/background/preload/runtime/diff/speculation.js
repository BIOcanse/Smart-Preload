(function () {
  function syncPrerenderTargets(preloadState, normalWindowId, sourceTabId, targets) {
    return synchronizePrerenderEntriesForSourceTab(
      preloadState,
      normalWindowId,
      sourceTabId,
      targets
    );
  }

  function syncPrefetchTargets(preloadState, normalWindowId, sourceTabId, targets) {
    return synchronizePrefetchEntriesForSourceTab(
      preloadState,
      normalWindowId,
      sourceTabId,
      targets
    );
  }

  globalThis.ZeroLatencySpeculationPreloadDiff = {
    syncPrerenderTargets,
    syncPrefetchTargets,
  };
})();
