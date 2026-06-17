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

  globalThis.normalizeSourceTabRuntime = normalizeSourceTabRuntime;
})();
