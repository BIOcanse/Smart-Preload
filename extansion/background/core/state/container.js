(function () {
  class ZeroLatencyBackgroundState {
    constructor({ settingsApi, chromeStorage }) {
      this.settingsApi = settingsApi;
      this.chromeStorage = chromeStorage;
      this.keys = createBackgroundStateKeys(settingsApi);
      this.constants = createBackgroundStateConstants();
      this.mutationQueue = Promise.resolve();
      this.sideEffectQueue = Promise.resolve();
      this.visitGraphEnginePromise = null;
      this.expectedPreloadTabRemovals = new Set();
      this.cachedUserSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
    }

    queueMutation(task) {
      const nextMutation = this.mutationQueue.then(task);

      this.mutationQueue = nextMutation.catch((error) => {
        console.error("Zero-Latency mutation failed.", error);
      });

      return nextMutation;
    }

    queueSideEffect(task) {
      const nextSideEffect = this.sideEffectQueue.then(task);

      this.sideEffectQueue = nextSideEffect.catch((error) => {
        console.error("Zero-Latency side effect failed.", error);
      });

      return nextSideEffect;
    }

    setCachedSettings(value) {
      this.cachedUserSettings = this.settingsApi.normalizeStoredSettings(value);
      return this.cachedUserSettings;
    }

    getEffectiveExtensionSettings() {
      return this.settingsApi.resolveEffectiveSettings(this.cachedUserSettings);
    }

    markExpectedPreloadRemoval(tabId) {
      this.expectedPreloadTabRemovals.add(Number(tabId));
    }

    clearExpectedPreloadRemoval(tabId) {
      this.expectedPreloadTabRemovals.delete(Number(tabId));
    }

    consumeExpectedPreloadRemoval(tabId) {
      return this.expectedPreloadTabRemovals.delete(Number(tabId));
    }

    async loadTrackingState() {
      return loadTrackingStateForBackgroundState(this);
    }

    async saveTrackingState(state) {
      await saveTrackingStateForBackgroundState(this, state);
    }

    async loadPreloadState() {
      return loadPreloadStateForBackgroundState(this);
    }

    async savePreloadState(preloadState) {
      await savePreloadStateForBackgroundState(this, preloadState);
    }

    async loadServiceState() {
      return loadServiceStateForBackgroundState(this);
    }

    async saveServiceState(serviceState) {
      await saveServiceStateForBackgroundState(this, serviceState);
    }

    async initializeExtensionState() {
      await initializeExtensionStateForBackgroundState(this);
    }

    async hydrateTabStateFromOpenTabs(preloadState) {
      return hydrateTabStateFromOpenTabsForBackgroundState(preloadState);
    }
  }

  globalThis.ZeroLatencyBackgroundState = ZeroLatencyBackgroundState;
})();
