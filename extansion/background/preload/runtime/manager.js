(function () {
  // High-level runtime supervisor. Keep message/runtime/watchdog entry points
  // calling this boundary instead of reaching deep helpers directly.
  async function registerCandidates(message, sender) {
    return registerPreloadCandidates(message, sender);
  }

  async function activateIfReady(message, sender) {
    return activatePreloadedPage(message, sender);
  }

  async function getInteractionPreloadStatus(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.getInteractionPreloadStatus(message, sender);
  }

  async function startInteractionPreload(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.startInteractionPreload(message, sender);
  }

  async function cancelInteractionPreloads(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.cancelInteractionPreloads(message, sender);
  }

  async function activateCreatedNavigationTarget(details, options = {}) {
    return globalThis.ZeroLatencyContextMenuPreloadInteraction.activateCreatedNavigationTarget(
      details,
      options
    );
  }

  async function activateUpdatedTabNavigationTarget(details) {
    return globalThis.ZeroLatencyContextMenuPreloadInteraction.activateUpdatedTabNavigationTarget(
      details
    );
  }

  async function maintain() {
    if (typeof globalThis.ZeroLatencyPreloadHeartbeat?.maintain === "function") {
      await globalThis.ZeroLatencyPreloadHeartbeat.maintain();
      return;
    }

    await globalThis.ZeroLatencyPreloadWindowManager.maintainPolicy();
  }

  async function ensureWarmWindows() {
    await globalThis.ZeroLatencyPreloadWindowManager.ensureWarmWindows();
  }

  async function cleanupErroneousWindows() {
    await globalThis.ZeroLatencyPreloadWindowManager.cleanupErroneousWindowsNow();
  }

  globalThis.ZeroLatencyPreloadRuntimeManager = {
    registerCandidates,
    activateIfReady,
    getInteractionPreloadStatus,
    startInteractionPreload,
    cancelInteractionPreloads,
    activateCreatedNavigationTarget,
    activateUpdatedTabNavigationTarget,
    maintain,
    ensureWarmWindows,
    cleanupErroneousWindows,
  };
})();
