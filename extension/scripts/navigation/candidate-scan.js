(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    hasActiveEditableFocus,
    isPassivePrerenderContext,
    filterWaterfallDynamicLinks,
    registerPreloadCandidates,
    syncContentScriptPreloadPolicy,
    applySpeculationRules,
    collectPageContentSnapshot,
    collectCandidateLinks,
    buildCandidateLinksSignature,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
  } = namespace;

  async function sendCandidateLinks(options = {}) {
    if (state.candidateScanInFlight) {
      state.candidateScanPending = true;
      state.candidateScanPendingForce =
        state.candidateScanPendingForce || options.force === true;
      return;
    }

    state.candidateScanInFlight = true;

    try {
      await sendCandidateLinksNow(options);
    } finally {
      state.candidateScanInFlight = false;

      if (state.candidateScanPending) {
        const shouldForce = state.candidateScanPendingForce;
        state.candidateScanPending = false;
        state.candidateScanPendingForce = false;
        namespace.scheduleCandidateScan?.({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
          force: shouldForce,
        });
      }
    }
  }

  async function sendCandidateLinksNow(options = {}) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      return;
    }

    if (namespace.synchronizeCurrentPageGeneration?.() === true) {
      namespace.scheduleCandidateScan?.({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
        includePageDigest: true,
      });
      return;
    }

    const pageToken = options.pageToken ?? capturePageGenerationToken();

    if (!isPageGenerationTokenCurrent(pageToken)) {
      return;
    }

    const links = filterWaterfallDynamicLinks(collectCandidateLinks());
    const signature = buildCandidateLinksSignature(links);

    if (signature === state.lastSentCandidateSignature && options.force !== true) {
      return;
    }

    const pageSnapshot =
      options.pageSnapshot?.pageUrl === pageToken.pageUrl
        ? options.pageSnapshot
        : collectPageContentSnapshot();

    try {
      const response = await registerPreloadCandidates({
        pageUrl: pageSnapshot.pageUrl,
        pageTitle: pageSnapshot.title,
        pageTextDigest: pageSnapshot.textDigest,
        contentFingerprint: pageSnapshot.contentFingerprint,
        attentionActivity: namespace.buildAttentionActivitySnapshot?.() ?? null,
        links,
      });

      if (!isPageGenerationTokenCurrent(pageToken)) {
        return;
      }

      syncContentScriptPreloadPolicy(response?.contentScriptPolicy);
      state.lastSentCandidateSignature = signature;
      state.lastCandidateRegistrationGeneration = pageToken.pageGeneration;
      state.lastCandidateRegistrationUrl = pageToken.pageUrl;

      applySpeculationRules({
        prerenderTargets: response?.prerenderTargets ?? [],
        prefetchTargets: response?.prefetchTargets ?? [],
      });
    } catch (error) {
      if (isPageGenerationTokenCurrent(pageToken)) {
        applySpeculationRules({
          prerenderTargets: [],
          prefetchTargets: [],
        });
      }
      console.debug("Failed to register preload candidates.", error);
    }
  }

  Object.assign(namespace, {
    sendCandidateLinks,
  });
})();
