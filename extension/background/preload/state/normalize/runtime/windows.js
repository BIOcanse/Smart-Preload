(function () {
  function normalizeNormalWindowRuntime(rawValue, normalWindowId) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const normalizedWindowId =
      normalizePositiveInteger(nextValue.normalWindowId) ??
      normalizePositiveInteger(normalWindowId);
    const sourceTabs = {};

    for (const [sourceTabId, rawSourceTabRuntime] of Object.entries(nextValue.sourceTabs || {})) {
      const normalizedSourceTabRuntime = normalizeSourceTabRuntime(rawSourceTabRuntime, sourceTabId);

      if (normalizedSourceTabRuntime.sourceTabId !== null) {
        sourceTabs[String(normalizedSourceTabRuntime.sourceTabId)] = normalizedSourceTabRuntime;
      }
    }

    return {
      normalWindowId: normalizedWindowId,
      preloadWindow: normalizePreloadWindowState(nextValue.preloadWindow),
      sourceTabs,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizePreloadState(rawState) {
    const nextState = isPlainObject(rawState) ? rawState : createEmptyPreloadState();

    if (!isPlainObject(nextState.normalWindowsById)) {
      return createEmptyPreloadState();
    }

    const normalWindowsById = {};

    for (const [normalWindowId, rawWindowRuntime] of Object.entries(nextState.normalWindowsById)) {
      const normalizedWindowRuntime = normalizeNormalWindowRuntime(rawWindowRuntime, normalWindowId);

      if (normalizedWindowRuntime.normalWindowId !== null) {
        normalWindowsById[String(normalizedWindowRuntime.normalWindowId)] = normalizedWindowRuntime;
      }
    }

    return {
      version: 2,
      normalWindowsById,
      scheduler: normalizePreloadSchedulerState(nextState.scheduler),
      updatedAt: typeof nextState.updatedAt === "string" ? nextState.updatedAt : null,
    };
  }

  globalThis.normalizeNormalWindowRuntime = normalizeNormalWindowRuntime;
  globalThis.normalizePreloadState = normalizePreloadState;
})();
