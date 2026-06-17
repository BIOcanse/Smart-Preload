(function () {
  function isLegacyPreloadState(rawState) {
    return (
      isPlainObject(rawState) &&
      !isPlainObject(rawState.normalWindowsById) &&
      (
        normalizePositiveInteger(rawState.windowId) !== null ||
        isPlainObject(rawState.entriesBySourceTab) ||
        isPlainObject(rawState.prerenderEntriesBySourceTab) ||
        isPlainObject(rawState.prefetchEntriesBySourceTab)
      )
    );
  }

  async function migrateLegacyPreloadState(rawState) {
    if (!isLegacyPreloadState(rawState)) {
      return normalizePreloadState(rawState);
    }

    return createEmptyPreloadState();
  }

  globalThis.isLegacyPreloadState = isLegacyPreloadState;
  globalThis.migrateLegacyPreloadState = migrateLegacyPreloadState;
})();
