// Preload-window reuse and discovery. This layer proves whether a live Chrome
// window is still one of ours; creation.js decides when to call it.

async function tryReuseTrackedPreloadWindow({
  normalWindowRuntime,
  normalWindowId,
  existingWindowId,
  useSystemHiding,
  sourceWindowIncognito,
}) {
  if (Number.isFinite(existingWindowId)) {
    const existingWindow = await getWindowMaybe(existingWindowId);
    // Chrome window IDs are session-scoped and can be reused after restart/profile switch.
    // Never hide a persisted window id unless the live window still proves it is ours.
    const existingWindowStillLooksLikePreloadWindow =
      existingWindow?.type === "normal" &&
      existingWindow.incognito === sourceWindowIncognito &&
      (await isLivePreloadWindowForRuntime(normalWindowRuntime, existingWindow.id));

    if (existingWindowStillLooksLikePreloadWindow) {
      globalThis.markKnownPreloadWindow?.(existingWindow.id);
      await ensurePreloadWindowHiddenState({
        normalWindowRuntime,
        windowId: existingWindow.id,
        actualWindow: existingWindow,
        useSystemHiding,
      });
      await refocusNormalWindowIfPreloadWindowFocused(
        existingWindow.id,
        normalWindowId,
        "reuse-tracked"
      );
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-tracked", {
        normalWindowId,
        preloadWindowId: existingWindow.id,
        hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
        hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
        sourceIncognito: sourceWindowIncognito,
      });

      return {
        windowId: existingWindow.id,
        created: false,
        hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
      };
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.stale-window", {
      normalWindowId,
      existingWindowId,
      reason:
        existingWindow?.type === "normal" &&
        existingWindow.incognito !== sourceWindowIncognito
          ? "incognito-mismatch"
          : existingWindow?.type === "normal" ? "identity-mismatch" : "missing-window",
    });
    globalThis.clearKnownPreloadWindow?.(existingWindowId);
    resetPreloadWindowState(normalWindowRuntime.preloadWindow);
  }

  return null;
}

async function tryReuseDiscoveredPreloadWindow({
  preloadState,
  normalWindowRuntime,
  normalWindowId,
  useSystemHiding,
  sourceWindowIncognito,
}) {
  const reusableWindowId = await findReusablePreloadWindowId(
    preloadState,
    normalWindowId,
    sourceWindowIncognito
  );

  if (Number.isFinite(reusableWindowId)) {
    commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, reusableWindowId);
    const reusableWindow = await getWindowMaybe(reusableWindowId);
    globalThis.markKnownPreloadWindow?.(reusableWindowId);

    if (reusableWindow?.type === "normal") {
      await ensurePreloadWindowHiddenState({
        normalWindowRuntime,
        windowId: reusableWindowId,
        actualWindow: reusableWindow,
        useSystemHiding,
      });
      await refocusNormalWindowIfPreloadWindowFocused(
        reusableWindowId,
        normalWindowId,
        "reuse-discovered"
      );
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-discovered-selected", {
      normalWindowId,
      preloadWindowId: reusableWindowId,
      hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
      hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
      sourceIncognito: sourceWindowIncognito,
    });

    return {
      windowId: reusableWindowId,
      created: false,
      hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    };
  }

  return null;
}
