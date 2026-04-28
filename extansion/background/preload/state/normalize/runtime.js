(function () {
  function normalizeSourceTabRuntime(rawValue, sourceTabId) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const hiddenTabEntriesByUrl = {};
    const prerenderEntriesByUrl = {};
    const prefetchEntriesByUrl = {};

    for (const [url, rawEntry] of Object.entries(nextValue.hiddenTabEntriesByUrl || {})) {
      const normalizedEntry = normalizeHiddenTabPreloadEntry(rawEntry);

      if (normalizedEntry.requestedUrl) {
        hiddenTabEntriesByUrl[url] = normalizedEntry;
      }
    }

    for (const [url, rawEntry] of Object.entries(nextValue.prerenderEntriesByUrl || {})) {
      const normalizedEntry = normalizeSyntheticPreloadEntry(rawEntry, "prerender");

      if (normalizedEntry.requestedUrl) {
        prerenderEntriesByUrl[url] = normalizedEntry;
      }
    }

    for (const [url, rawEntry] of Object.entries(nextValue.prefetchEntriesByUrl || {})) {
      const normalizedEntry = normalizeSyntheticPreloadEntry(rawEntry, "prefetch");

      if (normalizedEntry.requestedUrl) {
        prefetchEntriesByUrl[url] = normalizedEntry;
      }
    }

    return {
      sourceTabId:
        normalizePositiveInteger(nextValue.sourceTabId) ??
        normalizePositiveInteger(sourceTabId),
      hiddenTabEntriesByUrl,
      prerenderEntriesByUrl,
      prefetchEntriesByUrl,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

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
      updatedAt: typeof nextState.updatedAt === "string" ? nextState.updatedAt : null,
    };
  }

  globalThis.normalizeSourceTabRuntime = normalizeSourceTabRuntime;
  globalThis.normalizeNormalWindowRuntime = normalizeNormalWindowRuntime;
  globalThis.normalizePreloadState = normalizePreloadState;
})();
