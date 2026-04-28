(function () {
  // Explicit preload-window submanager. Window creation/hiding/repair/cleanup
  // entry points should route through here instead of scattering direct helper
  // calls across runtime/source-tab/lifecycle code.
  function ensureWindow(preloadState, normalWindowId) {
    return ensurePreloadWindow(preloadState, normalWindowId);
  }

  function maintainHiddenState(windowId, options = {}) {
    return keepPreloadWindowMinimized(windowId, options);
  }

  function closeWindowForNormalWindow(preloadState, normalWindowId) {
    return closePreloadWindowForNormalWindow(preloadState, normalWindowId);
  }

  function repairEntriesForWindow(preloadState, normalWindowId, preloadWindowId) {
    return repairPreloadEntries(preloadState, normalWindowId, preloadWindowId);
  }

  function maintainPolicy() {
    return enforcePreloadWindowPolicy();
  }

  function cleanupErroneousWindows(preloadState) {
    return cleanupErroneousPreloadWindows(preloadState);
  }

  function cleanupErroneousWindowsNow() {
    return runErroneousPreloadWindowCleanup();
  }

  function handleRemovedWindowEvent(windowId) {
    return handleRemovedWindow(windowId);
  }

  function handleBoundsChangedEvent(window) {
    return handlePreloadWindowBoundsChanged(window);
  }

  globalThis.ZeroLatencyPreloadWindowManager = {
    ensureWindow,
    maintainHiddenState,
    closeWindowForNormalWindow,
    repairEntriesForWindow,
    maintainPolicy,
    cleanupErroneousWindows,
    cleanupErroneousWindowsNow,
    handleRemovedWindowEvent,
    handleBoundsChangedEvent,
  };
})();
