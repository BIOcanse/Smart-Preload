async function refocusNormalWindowIfPreloadWindowFocused(
  preloadWindowId,
  normalWindowId,
  reason
) {
  const normalizedPreloadWindowId = normalizePositiveFiniteNumber(preloadWindowId);
  const normalizedNormalWindowId = normalizePositiveFiniteNumber(normalWindowId);

  if (normalizedPreloadWindowId === null || normalizedNormalWindowId === null) {
    return;
  }

  const preloadWindow = await getWindowMaybe(normalizedPreloadWindowId);

  if (preloadWindow?.focused !== true) {
    return;
  }

  try {
    await chrome.windows.update(normalizedNormalWindowId, { focused: true });
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.focus.restore-source", {
      preloadWindowId: normalizedPreloadWindowId,
      normalWindowId: normalizedNormalWindowId,
      reason,
    });
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.focus.restore-source-failed", {
      preloadWindowId: normalizedPreloadWindowId,
      normalWindowId: normalizedNormalWindowId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
