(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    scheduleCandidateScan,
    applySpeculationRules,
    clearAllSpeculationRules,
  } = namespace;

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      namespace.synchronizeCurrentPageGeneration?.();

      if (message?.type === "preload:collect-candidates") {
        scheduleCandidateScan({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
          force: true,
          includePageDigest: true,
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
        if (!isScheduledSpeculationMessageCurrent(message)) {
          return;
        }

        applySpeculationRules({
          prerenderTargets: message.prerenderTargets ?? [],
          prefetchTargets: message.prefetchTargets ?? [],
        });
      }
    });
  }

  function isScheduledSpeculationMessageCurrent(message) {
    const messagePageUrl = String(message?.sourcePageUrl || message?.pageUrl || "");
    const messagePageGeneration = Number(message?.pageGeneration);

    if (messagePageUrl && messagePageUrl !== state.currentPageUrl) {
      return false;
    }

    if (
      Number.isFinite(messagePageGeneration) &&
      messagePageGeneration !== state.pageGeneration
    ) {
      return false;
    }

    return (
      state.lastCandidateRegistrationGeneration === state.pageGeneration &&
      state.lastCandidateRegistrationUrl === state.currentPageUrl
    );
  }

  Object.assign(namespace, {
    bindRuntimeMessages,
  });
})();
