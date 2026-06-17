(function () {
  async function initializeExtensionStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.SETTINGS_STORAGE_KEY]: null,
      [backgroundState.keys.GRAPH_KEY]: null,
      [backgroundState.keys.GRAPH_SUMMARY_KEY]: null,
      [backgroundState.keys.TAB_STATE_KEY]: null,
      [backgroundState.keys.PENDING_SOURCE_KEY]: null,
      [backgroundState.keys.PRELOAD_STATE_KEY]: null,
      [backgroundState.keys.SERVICE_STATE_KEY]: null,
    });

    backgroundState.setCachedSettings(stored[backgroundState.keys.SETTINGS_STORAGE_KEY]);
    const normalizedGraph = normalizeTrackingGraph(stored[backgroundState.keys.GRAPH_KEY]);
    const normalizedGraphSummary = normalizeTrackingGraphSummary(
      stored[backgroundState.keys.GRAPH_SUMMARY_KEY],
      normalizedGraph
    );
    const normalizedPreloadState = await sanitizeLivePreloadStateForBackgroundState(
      await migrateLegacyPreloadState(stored[backgroundState.keys.PRELOAD_STATE_KEY])
    );
    const hydratedTabState = await hydrateTabStateFromOpenTabsForBackgroundState(
      normalizedPreloadState
    );
    const normalizedServiceState = normalizeServiceState(
      stored[backgroundState.keys.SERVICE_STATE_KEY]
    );
    normalizedServiceState.bookmarkPreloading =
      await hydrateBookmarkPreloadingServiceStateForBackgroundState(
        normalizedPreloadState,
        normalizedServiceState.bookmarkPreloading
      );

    backgroundState.setCachedTrackingSnapshot({
      summary: normalizedGraphSummary,
      tabState: hydratedTabState,
    });
    backgroundState.setCachedPreloadState(normalizedPreloadState);
    backgroundState.setCachedServiceState(normalizedServiceState);

    await backgroundState.chromeStorage.set({
      [backgroundState.keys.SETTINGS_STORAGE_KEY]: backgroundState.cachedUserSettings,
      [backgroundState.keys.GRAPH_KEY]: normalizedGraph,
      [backgroundState.keys.GRAPH_SUMMARY_KEY]: normalizedGraphSummary,
      [backgroundState.keys.TAB_STATE_KEY]: hydratedTabState,
      [backgroundState.keys.PENDING_SOURCE_KEY]:
        normalizePendingSourceMap(stored[backgroundState.keys.PENDING_SOURCE_KEY]),
      [backgroundState.keys.PRELOAD_STATE_KEY]: normalizedPreloadState,
      [backgroundState.keys.SERVICE_STATE_KEY]: normalizedServiceState,
    });
  }

  globalThis.initializeExtensionStateForBackgroundState =
    initializeExtensionStateForBackgroundState;
})();
