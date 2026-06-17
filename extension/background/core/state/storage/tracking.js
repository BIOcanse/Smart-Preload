(function () {
  async function loadTrackingStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.GRAPH_KEY]: createEmptyGraph(),
      [backgroundState.keys.TAB_STATE_KEY]: {},
      [backgroundState.keys.PENDING_SOURCE_KEY]: {},
    });

    const trackingState = {
      graph: normalizeTrackingGraph(stored[backgroundState.keys.GRAPH_KEY]),
      tabState: normalizeTrackingTabStateMap(stored[backgroundState.keys.TAB_STATE_KEY]),
      pendingSources: normalizePendingSourceMap(stored[backgroundState.keys.PENDING_SOURCE_KEY]),
    };

    backgroundState.setCachedTrackingSnapshot({
      summary: buildTrackingGraphSummary(trackingState.graph),
      tabState: trackingState.tabState,
    });

    return trackingState;
  }

  async function loadTrackingSnapshotForPopupForBackgroundState(backgroundState) {
    return backgroundState.getCachedPopupSnapshot();
  }

  async function saveTrackingStateForBackgroundState(backgroundState, state) {
    const summary = buildTrackingGraphSummary(state.graph);
    const tabState = normalizeTrackingTabStateMap(state.tabState);

    backgroundState.setCachedTrackingSnapshot({
      summary,
      tabState,
    });

    await backgroundState.chromeStorage.set({
      [backgroundState.keys.GRAPH_KEY]: state.graph,
      [backgroundState.keys.GRAPH_SUMMARY_KEY]: summary,
      [backgroundState.keys.TAB_STATE_KEY]: tabState,
      [backgroundState.keys.PENDING_SOURCE_KEY]: normalizePendingSourceMap(state.pendingSources),
    });
  }

  globalThis.loadTrackingStateForBackgroundState = loadTrackingStateForBackgroundState;
  globalThis.loadTrackingSnapshotForPopupForBackgroundState =
    loadTrackingSnapshotForPopupForBackgroundState;
  globalThis.saveTrackingStateForBackgroundState = saveTrackingStateForBackgroundState;
})();
