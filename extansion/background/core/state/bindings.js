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
