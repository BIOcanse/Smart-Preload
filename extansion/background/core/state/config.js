(function () {
  function createBackgroundStateKeys(settingsApi) {
    return {
      SETTINGS_STORAGE_KEY: settingsApi.SETTINGS_STORAGE_KEY,
      GRAPH_KEY: "visitGraphV1",
      GRAPH_SUMMARY_KEY: "visitGraphSummaryV1",
      TAB_STATE_KEY: "tabVisitStateV1",
      PENDING_SOURCE_KEY: "pendingVisitSourcesV1",
      PRELOAD_STATE_KEY: "preloadStateV1",
      SERVICE_STATE_KEY: "extensionServiceStateV1",
    };
  }

  function createBackgroundStateConstants() {
    const constants = {
      MAX_DEBUG_TRANSITIONS: 30,
      STARTUP_SYNC_MESSAGE_WINDOW: 10,
      WASM_ENGINE_PATH: "wasm/pkg/visit_graph_engine.wasm",
      PRELOAD_WINDOW_WATCHDOG_ALARM: "preload-window-watchdog",
      PRELOAD_WINDOW_CLEANUP_ALARM: "preload-window-cleanup",
      PRELOAD_WINDOW_SENTINEL_URL: "about:blank#zero-latency-preload-window",
      BUCKET_PRIMARY_CHARSET: "abcdefghijklmnopqrstuvwxyz0123456789_",
      TRANSITION_WINDOW_KEYS: ["total", "last365d", "last30d", "last7d", "last1d"],
    };

    constants.BUCKET_SECONDARY_BLANK_INDEX = constants.BUCKET_PRIMARY_CHARSET.length;
    constants.OUTBOUND_BUCKET_COUNT =
      constants.BUCKET_PRIMARY_CHARSET.length *
      (constants.BUCKET_PRIMARY_CHARSET.length + 1);

    return constants;
  }

  globalThis.createBackgroundStateKeys = createBackgroundStateKeys;
  globalThis.createBackgroundStateConstants = createBackgroundStateConstants;
})();
