(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    isExtensionOnlyMutation,
    resetWaterfallBaseline,
    scheduleCandidateScan,
    schedulePageDigestReport,
  } = namespace;

  function createMutationObserver() {
    return new MutationObserver((mutations) => {
      if (mutations.every(isExtensionOnlyMutation)) {
        return;
      }

      if (location.href !== state.lastLocationHref) {
        state.lastLocationHref = location.href;
        state.lastSentCandidateSignature = null;
        resetWaterfallBaseline();
        schedulePageDigestReport();
      }

      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
      });
      schedulePageDigestReport();
    });
  }

  function startMutationObserverWhenReady(mutationObserver) {
    if (state.observerStarted) {
      return;
    }

    if (document.documentElement) {
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href", "target", "title", "aria-label", "alt"],
      });
      state.observerStarted = true;
      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
      });
      return;
    }

    if (state.observerReadinessListenerStarted) {
      return;
    }

    state.observerReadinessListenerStarted = true;
    document.addEventListener("readystatechange", () => {
      startMutationObserverWhenReady(mutationObserver);
    });
  }

  Object.assign(namespace, {
    createMutationObserver,
    startMutationObserverWhenReady,
  });
})();
