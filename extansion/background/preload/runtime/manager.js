(function () {
  // High-level runtime supervisor. Keep message/runtime/watchdog entry points
  // calling this boundary instead of reaching deep helpers directly.
  async function registerCandidates(message, sender) {
    return registerPreloadCandidates(message, sender);
  }

  async function activateIfReady(message, sender) {
    return activatePreloadedPage(message, sender);
  }

  async function maintain() {
    await globalThis.ZeroLatencyPreloadWindowManager.maintainPolicy();
  }

  async function cleanupErroneousWindows() {
    await globalThis.ZeroLatencyPreloadWindowManager.cleanupErroneousWindowsNow();
  }

  globalThis.ZeroLatencyPreloadRuntimeManager = {
    registerCandidates,
    activateIfReady,
    maintain,
    cleanupErroneousWindows,
  };
})();
