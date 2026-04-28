(function () {
  function createEmptyPreloadState() {
    return {
      version: 2,
      normalWindowsById: {},
      updatedAt: null,
    };
  }

  function createEmptyPreloadWindowState() {
    return {
      windowId: null,
      hwnd: null,
      hiddenBySystem: false,
      updatedAt: null,
    };
  }

  function resetPreloadWindowState(preloadWindowState) {
    const targetPreloadWindowState =
      preloadWindowState && typeof preloadWindowState === "object"
        ? preloadWindowState
        : createEmptyPreloadWindowState();

    targetPreloadWindowState.windowId = null;
    targetPreloadWindowState.hwnd = null;
    targetPreloadWindowState.hiddenBySystem = false;
    targetPreloadWindowState.updatedAt = null;
    return targetPreloadWindowState;
  }

  function createEmptyNormalWindowRuntime(normalWindowId) {
    return {
      normalWindowId: normalizePositiveInteger(normalWindowId),
      preloadWindow: createEmptyPreloadWindowState(),
      sourceTabs: {},
      updatedAt: null,
    };
  }

  function createEmptySourceTabRuntime(sourceTabId) {
    return {
      sourceTabId: normalizePositiveInteger(sourceTabId),
      hiddenTabEntriesByUrl: {},
      prerenderEntriesByUrl: {},
      prefetchEntriesByUrl: {},
      updatedAt: null,
    };
  }

  globalThis.createEmptyPreloadState = createEmptyPreloadState;
  globalThis.createEmptyPreloadWindowState = createEmptyPreloadWindowState;
  globalThis.resetPreloadWindowState = resetPreloadWindowState;
  globalThis.createEmptyNormalWindowRuntime = createEmptyNormalWindowRuntime;
  globalThis.createEmptySourceTabRuntime = createEmptySourceTabRuntime;
})();
