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

      // 这里不再作废页面摘要缓存：DOM 变更不是摘要的重建信号（见 page-digest.js）。
      // 变更仍然驱动候选链接的增量重扫，那条路是按 anchor 精确标脏的，与摘要无关。
      const pageChanged = synchronizeCurrentPageGeneration();

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
