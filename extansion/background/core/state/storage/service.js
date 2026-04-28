(function () {
  function createDefaultServiceState() {
    return {
      paused: false,
      updatedAt: null,
    };
  }

  function normalizeServiceState(value) {
    if (!isPlainObject(value)) {
      return createDefaultServiceState();
    }

    return {
      paused: value.paused === true,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
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
  globalThis.loadServiceStateForBackgroundState = loadServiceStateForBackgroundState;
  globalThis.saveServiceStateForBackgroundState = saveServiceStateForBackgroundState;
})();
