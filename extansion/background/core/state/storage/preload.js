(function () {
  async function loadPreloadStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.PRELOAD_STATE_KEY]: createEmptyPreloadState(),
    });

    return normalizePreloadState(stored[backgroundState.keys.PRELOAD_STATE_KEY]);
  }

  async function savePreloadStateForBackgroundState(backgroundState, preloadState) {
    await backgroundState.chromeStorage.set({
      [backgroundState.keys.PRELOAD_STATE_KEY]: normalizePreloadState(preloadState),
    });
  }

  globalThis.loadPreloadStateForBackgroundState = loadPreloadStateForBackgroundState;
  globalThis.savePreloadStateForBackgroundState = savePreloadStateForBackgroundState;
})();
