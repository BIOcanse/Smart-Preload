async function createPreloadWindowForRuntime({
  preloadState,
  normalWindowRuntime,
  normalWindowId,
  useSystemHiding,
  sourceWindowIncognito,
}) {
  const previousChromeWindowHwnds = useSystemHiding
    ? await captureNativeChromeWindowHwnds()
    : null;

  const createParams = {
    url: PRELOAD_WINDOW_SENTINEL_URL,
    focused: false,
    state: "minimized",
    type: "normal",
  };

  if (sourceWindowIncognito === true) {
    createParams.incognito = true;
  }

  const createdWindow = await chrome.windows.create(createParams);
  await ensurePreloadWindowHiddenState({
    normalWindowRuntime,
    windowId: createdWindow.id,
    actualWindow:
      (await getWindowMaybe(createdWindow.id)) ?? createdWindow,
    useSystemHiding,
    previousChromeWindowHwnds,
  });
  await refocusNormalWindowIfPreloadWindowFocused(
    createdWindow.id,
    normalWindowId,
    "created"
  );
  globalThis.markKnownPreloadWindow?.(createdWindow.id);

  commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, createdWindow.id);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.created", {
    normalWindowId,
    preloadWindowId: createdWindow.id,
    useSystemHiding,
    hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
    sourceIncognito: sourceWindowIncognito,
  });
  return {
    windowId: createdWindow.id,
    created: true,
    supported: true,
    hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
  };
}

function commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, preloadWindowId) {
  normalWindowRuntime.preloadWindow.windowId = preloadWindowId;
  normalWindowRuntime.preloadWindow.updatedAt = new Date().toISOString();
  normalWindowRuntime.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
  preloadState.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
}
