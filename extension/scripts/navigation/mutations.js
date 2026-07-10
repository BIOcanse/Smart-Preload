(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    isExtensionOnlyMutation,
    resetWaterfallBaseline,
    scheduleCandidateScan,
    enqueueCandidateMutations,
    initializeCandidateAnchorIndex,
    resetCandidateAnchorIndex,
    advancePageGeneration,
    markDocumentContentChanged,
    applySpeculationRules,
  } = namespace;

  function createMutationObserver() {
    return new MutationObserver((mutations) => {
      const relevantMutations = (mutations || []).filter(
        (mutation) => !isExtensionOnlyMutation(mutation)
      );

      if (!relevantMutations.length) {
        return;
      }

      const pageChanged = synchronizeCurrentPageGeneration();
      markDocumentContentChanged();

      if (!pageChanged) {
        enqueueCandidateMutations(relevantMutations);
      }

      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: pageChanged,
        includePageDigest: true,
      });
    });
  }

  function synchronizeCurrentPageGeneration() {
    if (!advancePageGeneration(location.href)) {
      return false;
    }

    resetWaterfallBaseline();
    resetCandidateAnchorIndex();
    initializeCandidateAnchorIndex(document.documentElement);
    applySpeculationRules({
      prerenderTargets: [],
      prefetchTargets: [],
    });
    return true;
  }

  function handlePageLocationChange() {
    if (!synchronizeCurrentPageGeneration()) {
      return;
    }

    scheduleCandidateScan({
      delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
      force: true,
      includePageDigest: true,
    });
  }

  function bindPageLocationEvents() {
    if (state.locationEventsBound) {
      return;
    }

    state.locationEventsBound = true;
    window.addEventListener("popstate", handlePageLocationChange);
    window.addEventListener("hashchange", handlePageLocationChange);
    globalThis.navigation?.addEventListener?.("currententrychange", handlePageLocationChange);
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
      bindPageLocationEvents();
      initializeCandidateAnchorIndex(document.documentElement);
      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
        includePageDigest: true,
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
    synchronizeCurrentPageGeneration,
    startMutationObserverWhenReady,
  });
})();
