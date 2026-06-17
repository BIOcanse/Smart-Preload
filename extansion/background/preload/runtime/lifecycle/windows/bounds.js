const preloadWindowBoundsRefreshTimersByWindowId = new Map();
const preloadWindowBoundsRefreshSignaturesByWindowId = new Map();
const PRELOAD_WINDOW_BOUNDS_REFRESH_DEBOUNCE_MS = 75;

async function handlePreloadWindowBoundsChanged(window) {
  const preloadState = await loadPreloadState();
  const preloadWindowRuntimeEntry = findNormalWindowRuntimeByPreloadWindowId(
    preloadState,
    window.id
  );

  if (!preloadWindowRuntimeEntry) {
    return;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.bounds-changed", {
    windowId: window.id,
    normalWindowId: preloadWindowRuntimeEntry.normalWindowId,
    left: window.left ?? null,
    top: window.top ?? null,
    width: window.width ?? null,
    height: window.height ?? null,
    state: window.state ?? null,
    hiddenBySystem:
      preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    hwnd:
      preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.hwnd ?? null,
  });

  if (preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.hiddenBySystem === true) {
    scheduleSystemHiddenBoundsRefresh(window, preloadWindowRuntimeEntry);
    return;
  }

  if (!getEffectiveExtensionSettings().preloadWindow.forceMinimize) {
    return;
  }

  if (window.state !== "minimized") {
    await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(window.id, {
      normalWindowRuntime: preloadWindowRuntimeEntry.normalWindowRuntime,
      trigger: "bounds-changed-minimize-fallback",
    });
  }
}

function scheduleSystemHiddenBoundsRefresh(window, preloadWindowRuntimeEntry) {
  const windowId = normalizePositiveInteger(window?.id);

  if (windowId === null) {
    return;
  }

  const boundsSignature = createPreloadWindowBoundsSignature(window);
  const lastAppliedSignature = preloadWindowBoundsRefreshSignaturesByWindowId.get(windowId) ?? null;

  if (boundsSignature !== null && lastAppliedSignature === boundsSignature) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.bounds-refresh-skip-duplicate", {
      windowId,
      normalWindowId: preloadWindowRuntimeEntry.normalWindowId,
      boundsSignature,
    });
    return;
  }

  clearPendingSystemHiddenBoundsRefresh(windowId);
  const timer = setTimeout(() => {
    preloadWindowBoundsRefreshTimersByWindowId.delete(windowId);
    preloadWindowBoundsRefreshSignaturesByWindowId.set(windowId, boundsSignature);

    void queueSideEffect(async () => {
      const preloadState = await loadPreloadState();
      const latestRuntimeEntry = findNormalWindowRuntimeByPreloadWindowId(preloadState, windowId);

      if (!latestRuntimeEntry) {
        return;
      }

      if (latestRuntimeEntry.normalWindowRuntime.preloadWindow.hiddenBySystem !== true) {
        return;
      }

      await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(windowId, {
        hiddenBySystem: true,
        hwnd: latestRuntimeEntry.normalWindowRuntime.preloadWindow.hwnd,
        normalWindowRuntime: latestRuntimeEntry.normalWindowRuntime,
        forceRefresh: true,
        trigger: "bounds-changed-debounced",
      });
    });
  }, PRELOAD_WINDOW_BOUNDS_REFRESH_DEBOUNCE_MS);

  preloadWindowBoundsRefreshTimersByWindowId.set(windowId, timer);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.bounds-refresh-scheduled", {
    windowId,
    normalWindowId: preloadWindowRuntimeEntry.normalWindowId,
    boundsSignature,
    debounceMs: PRELOAD_WINDOW_BOUNDS_REFRESH_DEBOUNCE_MS,
  });
}

function clearPendingSystemHiddenBoundsRefresh(windowId) {
  const normalizedWindowId = normalizePositiveInteger(windowId);

  if (normalizedWindowId === null) {
    return;
  }

  const timer = preloadWindowBoundsRefreshTimersByWindowId.get(normalizedWindowId);

  if (timer != null) {
    clearTimeout(timer);
    preloadWindowBoundsRefreshTimersByWindowId.delete(normalizedWindowId);
  }

  preloadWindowBoundsRefreshSignaturesByWindowId.delete(normalizedWindowId);
}

function createPreloadWindowBoundsSignature(window) {
  const windowId = normalizePositiveInteger(window?.id);

  if (windowId === null) {
    return null;
  }

  return [
    windowId,
    normalizeFiniteNumber(window?.left),
    normalizeFiniteNumber(window?.top),
    normalizeFiniteNumber(window?.width),
    normalizeFiniteNumber(window?.height),
    window?.state ?? "",
  ].join(":");
}

globalThis.handlePreloadWindowBoundsChanged = handlePreloadWindowBoundsChanged;
globalThis.clearPendingSystemHiddenBoundsRefresh = clearPendingSystemHiddenBoundsRefresh;
