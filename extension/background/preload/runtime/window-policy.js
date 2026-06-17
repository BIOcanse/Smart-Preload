(function () {
  globalThis.ZeroLatencyPreloadWindowPolicy = {
    enforcePreloadWindowPolicy,
    repairPreloadEntries,
    closePreloadWindowForNormalWindow,
    closeHiddenTabsForNormalWindowRuntime,
    cleanupErroneousPreloadWindows,
    runErroneousPreloadWindowCleanup,
    ensurePreloadWindowWatchdog,
    resolvePreloadFullscreenPressurePolicy,
    getPreloadResourcePressureState,
    getPreloadPerformanceWarningState,
    shouldDeferHiddenTabPreloadsForResourcePressure,
    applyPreloadResourcePressurePolicy,
  };
})();
