(function () {
  async function loadPreloadStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.PRELOAD_STATE_KEY]: createEmptyPreloadState(),
    });

    const preloadState = normalizePreloadState(stored[backgroundState.keys.PRELOAD_STATE_KEY]);

    backgroundState.setCachedPreloadState(preloadState);
    return preloadState;
  }

  async function savePreloadStateForBackgroundState(backgroundState, preloadState) {
    const normalizedPreloadState = normalizePreloadState(preloadState);

    backgroundState.setCachedPreloadState(normalizedPreloadState);
    await backgroundState.chromeStorage.set({
      [backgroundState.keys.PRELOAD_STATE_KEY]: normalizedPreloadState,
    });
  }

  globalThis.loadPreloadStateForBackgroundState = loadPreloadStateForBackgroundState;
  globalThis.savePreloadStateForBackgroundState = savePreloadStateForBackgroundState;
})();
