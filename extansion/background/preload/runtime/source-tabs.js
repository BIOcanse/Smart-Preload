(function () {
  globalThis.ZeroLatencyPreloadSourceTabs = {
    synchronizePreloadsForSourceTab,
    clearPreloadsForSourceTab,
    reassignSourceTabRuntimeIfNeeded,
    synchronizePrerenderEntriesForSourceTab,
    synchronizePrefetchEntriesForSourceTab,
    handleActivatedSourceTab,
  };
})();
