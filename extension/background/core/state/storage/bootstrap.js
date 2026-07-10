(function () {
  async function initializeExtensionStateForBackgroundState(backgroundState) {
    const taskRestorePromise = globalThis.ZeroLatencyBackgroundTaskPersistence?.restore?.(
      globalThis.ZeroLatencyBackgroundTaskStore
    );
    const threatLibraryPromise = globalThis.ZeroLatencyLocalThreatDatabase?.initialize?.();
    const storagePromise = backgroundState.chromeStorage.get({
      [backgroundState.keys.SETTINGS_STORAGE_KEY]: null,
      [backgroundState.keys.GRAPH_KEY]: null,
      [backgroundState.keys.GRAPH_SUMMARY_KEY]: null,
      [backgroundState.keys.TAB_STATE_KEY]: null,
      [backgroundState.keys.PENDING_SOURCE_KEY]: null,
      [backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY]: null,
      [backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]: null,
      [backgroundState.keys.PRELOAD_STATE_KEY]: null,
      [backgroundState.keys.SERVICE_STATE_KEY]: null,
    });
    const [, , stored] = await Promise.all([
      taskRestorePromise,
      threatLibraryPromise,
      storagePromise,
    ]);

    backgroundState.setCachedSettings(stored[backgroundState.keys.SETTINGS_STORAGE_KEY]);
    const normalizedGraph = normalizeTrackingGraph(stored[backgroundState.keys.GRAPH_KEY]);
    const normalizedPreloadState = await sanitizeLivePreloadStateForBackgroundState(
      await migrateLegacyPreloadState(stored[backgroundState.keys.PRELOAD_STATE_KEY])
    );
    const hydratedTabState = await hydrateTabStateFromOpenTabsForBackgroundState(
      normalizedPreloadState
    );
    const trackingState = {
      graph: normalizedGraph,
      tabState: normalizeTrackingTabStateMap(stored[backgroundState.keys.TAB_STATE_KEY]),
      pendingSources: normalizePendingSourceMap(
        stored[backgroundState.keys.PENDING_SOURCE_KEY]
      ),
    };
    await initializeTrackingStateCacheForBackgroundState(
      backgroundState,
      trackingState,
      stored[backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY],
      stored[backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]
    );
    trackingState.tabState = hydratedTabState;
    const normalizedGraphSummary = normalizeTrackingGraphSummary(
      stored[backgroundState.keys.GRAPH_SUMMARY_KEY],
      trackingState.graph
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
      [backgroundState.keys.GRAPH_KEY]: trackingState.graph,
      [backgroundState.keys.GRAPH_SUMMARY_KEY]: normalizedGraphSummary,
      [backgroundState.keys.TAB_STATE_KEY]: hydratedTabState,
      [backgroundState.keys.PENDING_SOURCE_KEY]: trackingState.pendingSources,
      [backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]: [],
      [backgroundState.keys.PRELOAD_STATE_KEY]: normalizedPreloadState,
      [backgroundState.keys.SERVICE_STATE_KEY]: normalizedServiceState,
    });
  }

  globalThis.initializeExtensionStateForBackgroundState =
    initializeExtensionStateForBackgroundState;
})();
