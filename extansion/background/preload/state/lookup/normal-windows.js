(function () {
  function getNormalWindowRuntime(preloadState, normalWindowId) {
    if (!isPlainObject(preloadState) || !isPlainObject(preloadState.normalWindowsById)) {
      return null;
    }

    const normalizedWindowId = normalizePositiveInteger(normalWindowId);

    if (normalizedWindowId === null) {
      return null;
    }

    return preloadState.normalWindowsById[String(normalizedWindowId)] ?? null;
  }

  function ensureNormalWindowRuntime(preloadState, normalWindowId) {
    const normalizedWindowId = normalizePositiveInteger(normalWindowId);

    if (normalizedWindowId === null) {
      throw new Error(`Invalid normal window id: ${normalWindowId}`);
    }

    if (!isPlainObject(preloadState.normalWindowsById)) {
      preloadState.normalWindowsById = {};
    }

    const key = String(normalizedWindowId);
    const existingRuntime = preloadState.normalWindowsById[key];

    if (existingRuntime) {
      return existingRuntime;
    }

    const nextRuntime = createEmptyNormalWindowRuntime(normalizedWindowId);
    preloadState.normalWindowsById[key] = nextRuntime;
    return nextRuntime;
  }

  function findNormalWindowRuntimeByPreloadWindowId(preloadState, preloadWindowId) {
    const normalizedWindowId = normalizePositiveInteger(preloadWindowId);

    if (normalizedWindowId === null) {
      return null;
    }

    for (const normalWindowRuntime of Object.values(preloadState.normalWindowsById || {})) {
      if (normalWindowRuntime?.preloadWindow?.windowId === normalizedWindowId) {
        return {
          normalWindowId: normalWindowRuntime.normalWindowId,
          normalWindowRuntime,
        };
      }
    }

    return null;
  }

  function hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime) {
    return Object.values(normalWindowRuntime?.sourceTabs || {}).some(
      (sourceTabRuntime) => Object.keys(sourceTabRuntime?.hiddenTabEntriesByUrl || {}).length > 0
    );
  }

  function hasAnyPreloadWindow(preloadState) {
    return Object.values(preloadState.normalWindowsById || {}).some((normalWindowRuntime) =>
      normalizePositiveInteger(normalWindowRuntime?.preloadWindow?.windowId) !== null
    );
  }

  globalThis.getNormalWindowRuntime = getNormalWindowRuntime;
  globalThis.ensureNormalWindowRuntime = ensureNormalWindowRuntime;
  globalThis.findNormalWindowRuntimeByPreloadWindowId = findNormalWindowRuntimeByPreloadWindowId;
  globalThis.hasHiddenPreloadEntriesForNormalWindow = hasHiddenPreloadEntriesForNormalWindow;
  globalThis.hasAnyPreloadWindow = hasAnyPreloadWindow;
})();
