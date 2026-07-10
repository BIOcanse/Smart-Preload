(function () {
  class ZeroLatencyBackgroundState {
    constructor({ settingsApi, chromeStorage }) {
      this.settingsApi = settingsApi;
      this.chromeStorage = chromeStorage;
      this.keys = createBackgroundStateKeys(settingsApi);
      this.constants = createBackgroundStateConstants();
      this.taskQueues = globalThis.ZeroLatencyBackgroundTaskQueues.create();
      this.initializationPromise = null;
      this.resolveReady = null;
      this.rejectReady = null;
      this.readyPromise = new Promise((resolve, reject) => {
        this.resolveReady = resolve;
        this.rejectReady = reject;
      });
      this.readyPromise.catch(() => {});
      this.visitGraphEnginePromise = null;
      this.expectedPreloadTabRemovals = new Set();
      this.cachedUserSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
      this.cachedTrackingGraphSummary = createEmptyTrackingGraphSummary();
      this.cachedTrackingTabState = {};
      this.cachedPreloadState = createEmptyPreloadState();
      this.cachedServiceState = createDefaultServiceState();
    }

    queueMutation(task) {
      return this.taskQueues.mutation.enqueue(task);
    }

    queueSideEffect(task) {
      return this.taskQueues.sideEffect.enqueue(task);
    }

    queueInteraction(task) {
      return this.taskQueues.mutation.enqueue(task, { priority: "high" });
    }

    queueLifecycle(key, task) {
      return this.taskQueues.lifecycle.enqueue(key, task);
    }

    queueCandidate(key, task) {
      return this.taskQueues.candidate.enqueue(key, task);
    }

    queueAttention(key, task) {
      return this.taskQueues.attention.enqueue(key, task);
    }

    queueAi(key, task) {
      return this.taskQueues.ai.enqueue(key, task);
    }

    setCachedSettings(value) {
      this.cachedUserSettings = this.settingsApi.normalizeStoredSettings(value);
      return this.cachedUserSettings;
    }

    setCachedTrackingSnapshot({ summary, tabState }) {
      this.cachedTrackingGraphSummary = normalizeTrackingGraphSummary(summary);
      this.cachedTrackingTabState = normalizeTrackingTabStateMap(tabState);
    }

    setCachedPreloadState(preloadState) {
      this.cachedPreloadState = normalizePreloadState(preloadState);
    }

    setCachedServiceState(serviceState) {
      this.cachedServiceState = normalizeServiceState(serviceState);
    }

    getCachedPopupSnapshot() {
      return {
        summary: normalizeTrackingGraphSummary(this.cachedTrackingGraphSummary),
        tabState: normalizeTrackingTabStateMap(this.cachedTrackingTabState),
        preloadState: normalizePreloadState(this.cachedPreloadState),
        serviceState: normalizeServiceState(this.cachedServiceState),
      };
    }

    getCachedServiceState() {
      return normalizeServiceState(this.cachedServiceState);
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

    async loadTrackingSnapshotForPopup() {
      return loadTrackingSnapshotForPopupForBackgroundState(this);
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
      if (!this.initializationPromise) {
        this.initializationPromise = initializeExtensionStateForBackgroundState(this);
        this.initializationPromise.then(this.resolveReady, this.rejectReady);
      }

      return this.initializationPromise;
    }

    whenReady() {
      return this.readyPromise;
    }

    async hydrateTabStateFromOpenTabs(preloadState) {
      return hydrateTabStateFromOpenTabsForBackgroundState(preloadState);
    }
  }

  globalThis.ZeroLatencyBackgroundState = ZeroLatencyBackgroundState;
})();
