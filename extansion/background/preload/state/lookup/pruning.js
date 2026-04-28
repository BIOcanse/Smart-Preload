(function () {
  function pruneNormalWindowRuntime(preloadState, normalWindowId) {
    const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

    if (!normalWindowRuntime) {
      return;
    }

    const hasSourceTabs = Object.keys(normalWindowRuntime.sourceTabs || {}).length > 0;
    const hasPreloadWindow =
      normalizePositiveInteger(normalWindowRuntime.preloadWindow?.windowId) !== null;

    if (hasSourceTabs || hasPreloadWindow) {
      return;
    }

    delete preloadState.normalWindowsById[String(normalWindowId)];
    preloadState.updatedAt = new Date().toISOString();
  }

  function pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId) {
    const runtimeEntry = getSourceTabRuntimeForWindow(preloadState, normalWindowId, sourceTabId);

    if (!runtimeEntry) {
      return;
    }

    const { normalWindowRuntime, sourceTabRuntime } = runtimeEntry;
    const hasEntries =
      Object.keys(sourceTabRuntime.hiddenTabEntriesByUrl || {}).length > 0 ||
      Object.keys(sourceTabRuntime.prerenderEntriesByUrl || {}).length > 0 ||
      Object.keys(sourceTabRuntime.prefetchEntriesByUrl || {}).length > 0;

    if (hasEntries) {
      return;
    }

    delete normalWindowRuntime.sourceTabs[String(sourceTabId)];
    normalWindowRuntime.updatedAt = new Date().toISOString();
    preloadState.updatedAt = new Date().toISOString();
    pruneNormalWindowRuntime(preloadState, normalWindowId);
  }

  globalThis.pruneNormalWindowRuntime = pruneNormalWindowRuntime;
  globalThis.pruneSourceTabRuntime = pruneSourceTabRuntime;
})();
