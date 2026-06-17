async function ensurePreloadWindowHiddenState({
  normalWindowRuntime,
  windowId,
  actualWindow,
  useSystemHiding,
  previousChromeWindowHwnds = null,
}) {
  const existingHiddenHwnd = normalizePositiveFiniteNumber(
    normalWindowRuntime?.preloadWindow?.hwnd
  );
  const alreadyHiddenBySystem =
    useSystemHiding &&
    normalWindowRuntime?.preloadWindow?.hiddenBySystem === true &&
    existingHiddenHwnd !== null &&
    previousChromeWindowHwnds === null;

  if (alreadyHiddenBySystem) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-skip-already-hidden", {
      windowId,
      hwnd: existingHiddenHwnd,
    });
    return;
  }

  if (useSystemHiding) {
    const didHideBySystem = await hidePreloadWindowBySystem({
      normalWindowRuntime,
      windowId,
      actualWindow,
      previousChromeWindowHwnds,
    });

    if (didHideBySystem) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-success", {
        windowId,
        hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
      });
      return;
    }
  }

  try {
    await chrome.windows.update(windowId, { state: "minimized" });
  } catch (_error) {
    // Fallback minimize may fail transiently.
  }

  normalWindowRuntime.preloadWindow.hwnd = null;
  normalWindowRuntime.preloadWindow.hiddenBySystem = false;
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.minimize-fallback", {
    windowId,
    useSystemHiding,
  });
}

async function hidePreloadWindowBySystem({
  normalWindowRuntime,
  windowId,
  actualWindow,
  previousChromeWindowHwnds = null,
}) {
  if (typeof globalThis.nativeAppHideWindow !== "function") {
    return false;
  }

  const preloadWindowState = normalWindowRuntime?.preloadWindow;
  const hideBackoff = getPreloadWindowSystemHideBackoff(preloadWindowState);

  if (hideBackoff.active) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-backoff-skip", {
      windowId,
      disabledUntil: hideBackoff.disabledUntil,
      remainingMs: hideBackoff.remainingMs,
    });
    return false;
  }

  const liveWindow = actualWindow ?? (await getWindowMaybe(windowId));

  if (!liveWindow) {
    return false;
  }

  const resolvedHwnd =
    normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd) ??
    (await detectCreatedPreloadWindowHwnd(previousChromeWindowHwnds, liveWindow)) ??
    (await detectChromeWindowHwndByPreloadSentinel(liveWindow)) ??
    (await detectChromeWindowHwndByBounds(liveWindow));
  const hideResult = await nativeAppHideWindow({
    hwnd: resolvedHwnd ?? undefined,
    titleContains: PRELOAD_WINDOW_SENTINEL_URL,
    left: liveWindow.left,
    top: liveWindow.top,
    width: liveWindow.width,
    height: liveWindow.height,
  });

  if (hideResult?.ok === true) {
    normalWindowRuntime.preloadWindow.hwnd =
      normalizePositiveFiniteNumber(hideResult.hwnd) ?? resolvedHwnd ?? null;
    normalWindowRuntime.preloadWindow.hiddenBySystem = true;
    recordPreloadWindowSystemHideSuccess(
      normalWindowRuntime.preloadWindow,
      normalWindowRuntime.preloadWindow.hwnd
    );
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-result", {
      windowId,
      ok: true,
      hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
    });
    return true;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-result", {
    windowId,
    ok: false,
    resolvedHwnd,
    error: hideResult?.error || null,
  });
  recordPreloadWindowSystemHideFailure(
    normalWindowRuntime?.preloadWindow,
    hideResult?.error || "native-hide-failed"
  );
  return false;
}
