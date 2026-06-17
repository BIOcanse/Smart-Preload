(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    sleep,
    hasActiveEditableFocus,
    isPassivePrerenderContext,
    filterWaterfallDynamicLinks,
    registerPreloadCandidates,
    syncContentScriptPreloadPolicy,
    applySpeculationRules,
    collectPageTextDigest,
    buildPageContentFingerprint,
    collectCandidateLinks,
    buildCandidateLinksSignature,
  } = namespace;

  async function sendCandidateLinks(options = {}) {
    if (state.candidateScanInFlight) {
      state.candidateScanPending = true;
      return;
    }

    state.candidateScanInFlight = true;

    try {
      await sendCandidateLinksNow(options);
    } finally {
      state.candidateScanInFlight = false;

      if (state.candidateScanPending) {
        state.candidateScanPending = false;
        namespace.scheduleCandidateScan?.({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
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

    const candidateSnapshot = await collectStableCandidateLinkSnapshot();

    if (!candidateSnapshot) {
      return;
    }

    const { links, signature } = candidateSnapshot;

    if (signature === state.lastSentCandidateSignature && options.force !== true) {
      return;
    }

    try {
      const response = await registerPreloadCandidates({
        pageUrl: location.href,
        pageTitle: document.title || "",
        pageTextDigest: collectPageTextDigest(),
        contentFingerprint: buildPageContentFingerprint(),
        attentionActivity: namespace.buildAttentionActivitySnapshot?.() ?? null,
        links,
      });
      syncContentScriptPreloadPolicy(response?.contentScriptPolicy);
      state.lastSentCandidateSignature = signature;

      applySpeculationRules({
        prerenderTargets: response?.prerenderTargets ?? [],
        prefetchTargets: response?.prefetchTargets ?? [],
      });
    } catch (error) {
      applySpeculationRules({
        prerenderTargets: [],
        prefetchTargets: [],
      });
      console.debug("Failed to register preload candidates.", error);
    }
  }

  async function collectStableCandidateLinkSnapshot() {
    const startedAt = Date.now();
    let previousSignature = null;
    let latestLinks = [];
    let latestSignature = "";

    while (true) {
      if (isPassivePrerenderContext() || hasActiveEditableFocus()) {
        return null;
      }

      latestLinks = filterWaterfallDynamicLinks(collectCandidateLinks());
      latestSignature = buildCandidateLinksSignature(latestLinks);

      if (previousSignature === latestSignature) {
        if (latestLinks.length > 0 || document.readyState !== "loading") {
          return {
            links: latestLinks,
            signature: latestSignature,
          };
        }

        return null;
      }

      if (Date.now() - startedAt >= constants.LINK_STABILITY_MAX_WAIT_MS) {
        if (latestLinks.length === 0 && document.readyState === "loading") {
          return null;
        }

        return {
          links: latestLinks,
          signature: latestSignature,
        };
      }

      previousSignature = latestSignature;
      await sleep(constants.LINK_STABILITY_POLL_MS);
    }
  }

  Object.assign(namespace, {
    sendCandidateLinks,
  });
})();
