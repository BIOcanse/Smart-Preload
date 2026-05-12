(function () {
  function createDefaultServiceState() {
    return {
      paused: false,
      bookmarkPreloading: createDefaultBookmarkPreloadingServiceState(),
      updatedAt: null,
    };
  }

  function createDefaultBookmarkPreloadingServiceState() {
    return {
      startupGoogleSearchTabId: null,
      startupGoogleSearchWindowId: null,
    };
  }

  function normalizeServiceState(value) {
    if (!isPlainObject(value)) {
      return createDefaultServiceState();
    }

    return {
      paused: value.paused === true,
      bookmarkPreloading: normalizeBookmarkPreloadingServiceState(
        value.bookmarkPreloading
      ),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    };
  }

  function normalizeBookmarkPreloadingServiceState(value) {
    if (!isPlainObject(value)) {
      return createDefaultBookmarkPreloadingServiceState();
    }

    return {
      startupGoogleSearchTabId: normalizePositiveInteger(
        value.startupGoogleSearchTabId,
        null
      ),
      startupGoogleSearchWindowId: normalizePositiveInteger(
        value.startupGoogleSearchWindowId,
        null
      ),
    };
  }

  async function loadServiceStateForBackgroundState(backgroundState) {
    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.SERVICE_STATE_KEY]: createDefaultServiceState(),
    });

    return normalizeServiceState(stored[backgroundState.keys.SERVICE_STATE_KEY]);
  }

  async function saveServiceStateForBackgroundState(backgroundState, serviceState) {
    await backgroundState.chromeStorage.set({
      [backgroundState.keys.SERVICE_STATE_KEY]: normalizeServiceState(serviceState),
    });
  }

  globalThis.createDefaultServiceState = createDefaultServiceState;
  globalThis.normalizeServiceState = normalizeServiceState;
  globalThis.normalizeBookmarkPreloadingServiceState =
    normalizeBookmarkPreloadingServiceState;
  globalThis.loadServiceStateForBackgroundState = loadServiceStateForBackgroundState;
  globalThis.saveServiceStateForBackgroundState = saveServiceStateForBackgroundState;
})();
