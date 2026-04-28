(function () {
  function getSourceTabRuntimeForWindow(preloadState, normalWindowId, sourceTabId) {
    const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

    if (!normalWindowRuntime) {
      return null;
    }

    const normalizedSourceTabId = normalizePositiveInteger(sourceTabId);

    if (normalizedSourceTabId === null) {
      return null;
    }

    const sourceTabRuntime = normalWindowRuntime.sourceTabs[String(normalizedSourceTabId)] ?? null;

    if (!sourceTabRuntime) {
      return null;
    }

    return {
      normalWindowId: normalWindowRuntime.normalWindowId,
      normalWindowRuntime,
      sourceTabRuntime,
    };
  }

  function ensureSourceTabRuntime(preloadState, normalWindowId, sourceTabId) {
    const normalWindowRuntime = ensureNormalWindowRuntime(preloadState, normalWindowId);
    const normalizedSourceTabId = normalizePositiveInteger(sourceTabId);

    if (normalizedSourceTabId === null) {
      throw new Error(`Invalid source tab id: ${sourceTabId}`);
    }

    const key = String(normalizedSourceTabId);
    const existingRuntime = normalWindowRuntime.sourceTabs[key];

    if (existingRuntime) {
      return {
        normalWindowId: normalWindowRuntime.normalWindowId,
        normalWindowRuntime,
        sourceTabRuntime: existingRuntime,
      };
    }

    const nextRuntime = createEmptySourceTabRuntime(normalizedSourceTabId);
    normalWindowRuntime.sourceTabs[key] = nextRuntime;
    return {
      normalWindowId: normalWindowRuntime.normalWindowId,
      normalWindowRuntime,
      sourceTabRuntime: nextRuntime,
    };
  }

  function findSourceTabRuntime(preloadState, sourceTabId) {
    const normalizedSourceTabId = normalizePositiveInteger(sourceTabId);

    if (normalizedSourceTabId === null) {
      return null;
    }

    for (const normalWindowRuntime of Object.values(preloadState.normalWindowsById || {})) {
      const sourceTabRuntime = normalWindowRuntime?.sourceTabs?.[String(normalizedSourceTabId)] ?? null;

      if (sourceTabRuntime) {
        return {
          normalWindowId: normalWindowRuntime.normalWindowId,
          normalWindowRuntime,
          sourceTabRuntime,
        };
      }
    }

    return null;
  }

  globalThis.getSourceTabRuntimeForWindow = getSourceTabRuntimeForWindow;
  globalThis.ensureSourceTabRuntime = ensureSourceTabRuntime;
  globalThis.findSourceTabRuntime = findSourceTabRuntime;
})();
