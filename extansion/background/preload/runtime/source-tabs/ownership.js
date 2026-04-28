async function reassignSourceTabRuntimeIfNeeded(preloadState, normalWindowId, sourceTabId) {
  const existingOwner = findSourceTabRuntime(preloadState, sourceTabId);

  if (!existingOwner || Number(existingOwner.normalWindowId) === Number(normalWindowId)) {
    return preloadState;
  }

  preloadState = await clearPreloadsForSourceTab(
    preloadState,
    existingOwner.normalWindowId,
    sourceTabId
  );

  const previousWindowRuntime = getNormalWindowRuntime(
    preloadState,
    existingOwner.normalWindowId
  );

  if (previousWindowRuntime && !hasHiddenPreloadEntriesForNormalWindow(previousWindowRuntime)) {
    await globalThis.ZeroLatencyPreloadWindowManager.closeWindowForNormalWindow(
      preloadState,
      existingOwner.normalWindowId
    );
    pruneNormalWindowRuntime(preloadState, existingOwner.normalWindowId);
  }

  return preloadState;
}
