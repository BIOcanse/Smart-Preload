(function () {
  globalThis.ZeroLatencyPreloadWindowPolicy = {
    enforcePreloadWindowPolicy,
    repairPreloadEntries,
    closePreloadWindowForNormalWindow,
    closeHiddenTabsForNormalWindowRuntime,
    cleanupErroneousPreloadWindows,
    runErroneousPreloadWindowCleanup,
    ensurePreloadWindowWatchdog,
  };
})();
