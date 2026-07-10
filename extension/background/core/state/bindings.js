(function () {
  function requireBackgroundState() {
    return globalThis.backgroundState;
  }

  globalThis.queueMutation = function queueMutation(task) {
    return requireBackgroundState().queueMutation(task);
  };

  globalThis.queueSideEffect = function queueSideEffect(task) {
    return requireBackgroundState().queueSideEffect(task);
  };

  globalThis.queueInteraction = function queueInteraction(task) {
    return requireBackgroundState().queueInteraction(task);
  };

  globalThis.queueLifecycle = function queueLifecycle(key, task) {
    return requireBackgroundState().queueLifecycle(key, task);
  };

  globalThis.queueCandidate = function queueCandidate(key, task) {
    return requireBackgroundState().queueCandidate(key, task);
  };

  globalThis.queueAttention = function queueAttention(key, task) {
    return requireBackgroundState().queueAttention(key, task);
  };

  globalThis.queueAi = function queueAi(key, task) {
    return requireBackgroundState().queueAi(key, task);
  };

  globalThis.whenBackgroundStateReady = function whenBackgroundStateReady() {
    return requireBackgroundState().whenReady();
  };

  globalThis.getEffectiveExtensionSettings = function getEffectiveExtensionSettings() {
    return requireBackgroundState().getEffectiveExtensionSettings();
  };

  globalThis.loadTrackingState = function loadTrackingState() {
    return requireBackgroundState().loadTrackingState();
  };

  globalThis.loadTrackingSnapshotForPopup = function loadTrackingSnapshotForPopup() {
    return requireBackgroundState().loadTrackingSnapshotForPopup();
  };

  globalThis.saveTrackingState = function saveTrackingState(state) {
    return requireBackgroundState().saveTrackingState(state);
  };

  globalThis.loadPreloadState = function loadPreloadState() {
    return requireBackgroundState().loadPreloadState();
  };

  globalThis.savePreloadState = function savePreloadState(preloadState) {
    return requireBackgroundState().savePreloadState(preloadState);
  };

  globalThis.loadServiceState = function loadServiceState() {
    return requireBackgroundState().loadServiceState();
  };

  globalThis.getCachedServiceState = function getCachedServiceState() {
    return requireBackgroundState().getCachedServiceState();
  };

  globalThis.saveServiceState = function saveServiceState(serviceState) {
    return requireBackgroundState().saveServiceState(serviceState);
  };

  globalThis.isExtensionServicePaused = async function isExtensionServicePaused() {
    return (await requireBackgroundState().loadServiceState()).paused === true;
  };

  globalThis.initializeExtensionState = function initializeExtensionState() {
    return requireBackgroundState().initializeExtensionState();
  };

  globalThis.hydrateTabStateFromOpenTabs = function hydrateTabStateFromOpenTabs(preloadState) {
    return requireBackgroundState().hydrateTabStateFromOpenTabs(preloadState);
  };

  globalThis.markExpectedPreloadRemoval = function markExpectedPreloadRemoval(tabId) {
    return requireBackgroundState().markExpectedPreloadRemoval(tabId);
  };

  globalThis.clearExpectedPreloadRemoval = function clearExpectedPreloadRemoval(tabId) {
    return requireBackgroundState().clearExpectedPreloadRemoval(tabId);
  };

  globalThis.consumeExpectedPreloadRemoval = function consumeExpectedPreloadRemoval(tabId) {
    return requireBackgroundState().consumeExpectedPreloadRemoval(tabId);
  };
})();
