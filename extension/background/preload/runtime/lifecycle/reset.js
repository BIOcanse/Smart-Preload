async function resetPreloads() {
  globalThis.ZeroLatencyPreloadSchedulerAttention?.discardPendingAttention?.(
    "preload-reset"
  );
  const preloadState = await loadPreloadState();
  globalThis.clearKnownPreloadRuntime?.();

  for (const normalWindowRuntime of Object.values(preloadState.normalWindowsById || {})) {
    await closeHiddenTabsForNormalWindowRuntime(normalWindowRuntime);

    if (Number.isFinite(normalWindowRuntime.preloadWindow?.windowId)) {
      try {
        await chrome.windows.remove(normalWindowRuntime.preloadWindow.windowId);
      } catch (_error) {
        // The preload window may already be gone.
      }
    }
  }

  await cleanupErroneousPreloadWindows(createEmptyPreloadState());
  await savePreloadState(createEmptyPreloadState());
}
