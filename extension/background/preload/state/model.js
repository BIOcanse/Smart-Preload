(function () {
  function createEmptyPreloadState() {
    return {
      version: 2,
      normalWindowsById: {},
      scheduler: createEmptyPreloadSchedulerState(),
      updatedAt: null,
    };
  }

  function createEmptyPreloadSchedulerState() {
    return {
      attentionPool: {
        segments: [],
        totalDurationMs: 0,
        updatedAt: null,
      },
      attentionPendingByKey: {},
      activeTabCursor: {
        tabId: null,
        windowId: null,
        pageUrl: "",
        observedAt: null,
        counting: false,
        weight: 0,
        activityKind: "inactive",
        expiresAt: null,
        pendingDurationMs: 0,
        pendingStartedAt: null,
      },
      candidateSelectionSnapshotsByTabId: {},
      updatedAt: null,
    };
  }

  function createEmptyPreloadWindowState() {
    return {
      windowId: null,
      hwnd: null,
      hiddenBySystem: false,
      systemHideFailureCount: 0,
      systemHideDisabledUntil: null,
      lastSystemHideError: null,
      lastSystemHideFailedAt: null,
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
    targetPreloadWindowState.systemHideFailureCount = 0;
    targetPreloadWindowState.systemHideDisabledUntil = null;
    targetPreloadWindowState.lastSystemHideError = null;
    targetPreloadWindowState.lastSystemHideFailedAt = null;
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
  globalThis.createEmptyPreloadSchedulerState = createEmptyPreloadSchedulerState;
  globalThis.createEmptyPreloadWindowState = createEmptyPreloadWindowState;
  globalThis.resetPreloadWindowState = resetPreloadWindowState;
  globalThis.createEmptyNormalWindowRuntime = createEmptyNormalWindowRuntime;
  globalThis.createEmptySourceTabRuntime = createEmptySourceTabRuntime;
})();
