(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    scheduleCandidateScan,
    applySpeculationRules,
    clearAllSpeculationRules,
  } = namespace;

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "preload:collect-candidates") {
        scheduleCandidateScan({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
          force: true,
        });
        return;
      }

      if (message?.type === "preload:clear-speculation-rules") {
        if (typeof clearAllSpeculationRules === "function") {
          clearAllSpeculationRules();
        } else {
          applySpeculationRules({
            prerenderTargets: [],
            prefetchTargets: [],
          });
        }
        return;
      }

      if (message?.type === "preload:apply-speculation-rules") {
        applySpeculationRules({
          prerenderTargets: message.prerenderTargets ?? [],
          prefetchTargets: message.prefetchTargets ?? [],
        });
      }
    });
  }

  Object.assign(namespace, {
    bindRuntimeMessages,
  });
})();
