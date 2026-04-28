(function () {
  async function loadTrackingStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.GRAPH_KEY]: createEmptyGraph(),
      [backgroundState.keys.TAB_STATE_KEY]: {},
      [backgroundState.keys.PENDING_SOURCE_KEY]: {},
    });

    return {
      graph: normalizeTrackingGraph(stored[backgroundState.keys.GRAPH_KEY]),
      tabState: normalizeTrackingTabStateMap(stored[backgroundState.keys.TAB_STATE_KEY]),
      pendingSources: normalizePendingSourceMap(stored[backgroundState.keys.PENDING_SOURCE_KEY]),
    };
  }

  async function saveTrackingStateForBackgroundState(backgroundState, state) {
    await backgroundState.chromeStorage.set({
      [backgroundState.keys.GRAPH_KEY]: state.graph,
      [backgroundState.keys.TAB_STATE_KEY]: normalizeTrackingTabStateMap(state.tabState),
      [backgroundState.keys.PENDING_SOURCE_KEY]: normalizePendingSourceMap(state.pendingSources),
    });
  }

  globalThis.loadTrackingStateForBackgroundState = loadTrackingStateForBackgroundState;
  globalThis.saveTrackingStateForBackgroundState = saveTrackingStateForBackgroundState;
})();
