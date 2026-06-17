async function handleRemovedWindow(windowId) {
  clearPendingSystemHiddenBoundsRefresh(windowId);
  globalThis.clearKnownPreloadWindow?.(windowId);
  const preloadState = await loadPreloadState();
  let didMutate = false;

  const normalWindowRuntime = getNormalWindowRuntime(preloadState, windowId);

  if (normalWindowRuntime) {
    const pairedPreloadWindowId = normalizePositiveInteger(
      normalWindowRuntime.preloadWindow?.windowId
    );
    const removedWindowId = normalizePositiveInteger(windowId);

    await closeHiddenTabsForNormalWindowRuntime(normalWindowRuntime);

    if (
      pairedPreloadWindowId !== null &&
      removedWindowId !== null &&
      pairedPreloadWindowId !== removedWindowId
    ) {
      try {
        await chrome.windows.remove(pairedPreloadWindowId);
      } catch (_error) {
        // The paired preload window may already be gone.
      }
    }

    delete preloadState.normalWindowsById[String(windowId)];
    preloadState.updatedAt = new Date().toISOString();
    didMutate = true;
  }

  const preloadWindowRuntimeEntry = findNormalWindowRuntimeByPreloadWindowId(
    preloadState,
    windowId
  );

  if (preloadWindowRuntimeEntry) {
    const clearedAt = new Date().toISOString();
    resetPreloadWindowState(preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow);
    preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.updatedAt = clearedAt;
    preloadWindowRuntimeEntry.normalWindowRuntime.updatedAt =
      preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.updatedAt;
    preloadState.updatedAt = preloadWindowRuntimeEntry.normalWindowRuntime.preloadWindow.updatedAt;
    pruneNormalWindowRuntime(preloadState, preloadWindowRuntimeEntry.normalWindowId);
    didMutate = true;
  }

  if (didMutate) {
    await savePreloadState(preloadState);
  }
}

globalThis.handleRemovedWindow = handleRemovedWindow;
