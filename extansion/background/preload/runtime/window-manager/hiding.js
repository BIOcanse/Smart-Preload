async function refreshSystemHiddenPreloadWindow(windowId, options = {}) {
  if (typeof globalThis.nativeAppHideWindow !== "function") {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-skip", {
      windowId,
      reason: "native-app-unavailable",
    });
    return { ok: false, reason: "native-app-unavailable" };
  }

  const preloadWindow = await getWindowMaybe(windowId);

  if (!preloadWindow) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-skip", {
      windowId,
      reason: "window-missing",
    });
    return { ok: false, reason: "window-missing" };
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-attempt", {
    windowId,
    hwnd: normalizePositiveFiniteNumber(options?.hwnd, null),
    left: preloadWindow.left ?? null,
    top: preloadWindow.top ?? null,
    width: preloadWindow.width ?? null,
    height: preloadWindow.height ?? null,
    trigger: options?.trigger || null,
  });
  const hideResult = await nativeAppHideWindow({
    hwnd: normalizePositiveFiniteNumber(options?.hwnd, undefined),
    left: preloadWindow.left,
    top: preloadWindow.top,
    width: preloadWindow.width,
    height: preloadWindow.height,
  });

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-result", {
    windowId,
    ok: hideResult?.ok === true,
    hwnd: normalizePositiveFiniteNumber(hideResult?.hwnd, null),
    error: hideResult?.error || null,
    trigger: options?.trigger || null,
  });
  return {
    ok: hideResult?.ok === true,
    hwnd: normalizePositiveFiniteNumber(hideResult?.hwnd, null),
    error: hideResult?.error || null,
  };
}

async function keepPreloadWindowHidden(windowId, options = {}) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  if (globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() === true) {
    const hideBackoff = getPreloadWindowSystemHideBackoff(
      options?.normalWindowRuntime?.preloadWindow
    );

    if (hideBackoff.active) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-skip", {
        windowId,
        reason: "system-hide-backoff",
        disabledUntil: hideBackoff.disabledUntil,
        remainingMs: hideBackoff.remainingMs,
        trigger: options?.trigger || null,
      });
      return false;
    }

    const knownSystemHidden =
      options?.hiddenBySystem === true &&
      normalizePositiveFiniteNumber(options?.hwnd, null) !== null;

    if (knownSystemHidden && options?.forceRefresh !== true) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-refresh-skip", {
        windowId,
        hwnd: normalizePositiveFiniteNumber(options?.hwnd, null),
        reason: "already-hidden",
        trigger: options?.trigger || null,
      });
      return true;
    }

    const hideResult = await refreshSystemHiddenPreloadWindow(windowId, options);

    if (hideResult.ok) {
      if (options.normalWindowRuntime?.preloadWindow) {
        options.normalWindowRuntime.preloadWindow.hiddenBySystem = true;
        options.normalWindowRuntime.preloadWindow.hwnd =
          hideResult.hwnd ?? normalizePositiveFiniteNumber(options?.hwnd, null);
        recordPreloadWindowSystemHideSuccess(
          options.normalWindowRuntime.preloadWindow,
          options.normalWindowRuntime.preloadWindow.hwnd
        );
        options.normalWindowRuntime.preloadWindow.updatedAt = new Date().toISOString();
        options.normalWindowRuntime.updatedAt =
          options.normalWindowRuntime.preloadWindow.updatedAt;
      }
      return true;
    }

    recordPreloadWindowSystemHideFailure(
      options?.normalWindowRuntime?.preloadWindow,
      hideResult.error || hideResult.reason || "native-hide-refresh-failed"
    );
  }

  if (!getEffectiveExtensionSettings().preloadWindow.forceMinimize) {
    return false;
  }

  try {
    const preloadWindow = await getWindowMaybe(windowId);

    if (!preloadWindow || preloadWindow.state === "minimized") {
      return false;
    }

    await chrome.windows.update(windowId, {
      state: "minimized",
    });
    return true;
  } catch (_error) {
    // Ignore transient window update failures.
  }

  return false;
}

async function keepPreloadWindowMinimized(windowId, options = {}) {
  return keepPreloadWindowHidden(windowId, options);
}
