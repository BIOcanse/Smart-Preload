(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  const constants = {
    MAX_CANDIDATE_LINKS: 40,
    MAX_TEXT_DIGEST_CHARS: 2200,
    MAX_CANDIDATE_TEXT_CHARS: 240,
    MAX_NEARBY_TEXT_CHARS: 320,
    EARLY_LINK_RESCAN_DELAY_MS: 120,
    CANDIDATE_SCAN_MAX_WAIT_MS: 1000,
    CANDIDATE_IDLE_TIMEOUT_MS: 250,
    CANDIDATE_MUTATION_NODE_BATCH_SIZE: 80,
    CANDIDATE_DIRTY_ANCHOR_BATCH_SIZE: 32,
    BLANK_CLICK_RESOLUTION_TIMEOUT_MS: 500,
    CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS: 2500,
    HOVER_PRELOAD_DELAY_MS: 80,
    WATERFALL_BASELINE_MAX_UNLOCKED_MS: 2500,
    RESCAN_DELAY_MS: 700,
    PAGE_DIGEST_DELAY_MS: 1500,
    ATTENTION_ACTIVITY_INTERVAL_MS: 15_000,
    ATTENTION_ACTIVITY_MIN_REPORT_INTERVAL_MS: 1_000,
    SPECULATION_RULES_ELEMENT_ID: "zero-latency-speculation-rules",
  };

  const state = {
    currentPageUrl: location.href,
    pageGeneration: 1,
    documentContentRevision: 0,
    cachedPageContentSnapshot: null,
    candidateScanTimerId: null,
    candidateScanDueAt: 0,
    candidateScanMaxWaitTimerId: null,
    candidateScanCycleStartedAt: null,
    candidateScanIdleCallbackId: null,
    candidateScanIdleCallbackKind: "",
    candidateScanWorkInProgress: false,
    candidateScanForce: false,
    candidateScanIncludePageDigest: false,
    candidateScanInFlight: false,
    candidateScanPending: false,
    candidateScanPendingForce: false,
    candidateMutationWorkQueue: [],
    candidateQueuedTraversalItems: new WeakMap(),
    candidateDirtyAnchors: new Map(),
    candidateAnchorEntries: new Map(),
    candidateVisibilityCache: new WeakMap(),
    candidateVisibilityObserver: null,
    observerStarted: false,
    observerReadinessListenerStarted: false,
    locationEventsBound: false,
    deferredScanWhileEditing: false,
    deferredPageDigestWhileEditing: false,
    lastSentCandidateSignature: null,
    lastCandidateRegistrationGeneration: 0,
    lastCandidateRegistrationUrl: "",
    fixedCandidateUrlSet: null,
    waterfallBaselineStartedAt: 0,
    waterfallBaselineLocked: false,
    ignoreWaterfallDynamicLinks: true,
    skipSensitivePages: true,
    lastReportedPageDigestFingerprint: null,
    attentionActivityTimerId: null,
    lastUserInputAt: 0,
    lastLinkInteractionAt: 0,
    lastAttentionActivityReportedAt: 0,
    lastAttentionActivitySignature: "",
    hoverPreloadIntent: null,
    hoverPreloadSequence: 0,
    scheduledPrerenderTargets: [],
    scheduledPrefetchTargets: [],
    interactionPrerenderTargets: [],
    interactionPrefetchTargets: [],
  };

  function capturePageGenerationToken() {
    return {
      pageGeneration: state.pageGeneration,
      pageUrl: state.currentPageUrl,
    };
  }

  function isPageGenerationTokenCurrent(token) {
    return (
      Number(token?.pageGeneration) === state.pageGeneration &&
      String(token?.pageUrl || "") === state.currentPageUrl &&
      location.href === state.currentPageUrl
    );
  }

  function advancePageGeneration(nextPageUrl = location.href) {
    const normalizedPageUrl = String(nextPageUrl || location.href);

    if (normalizedPageUrl === state.currentPageUrl) {
      return false;
    }

    state.pageGeneration += 1;
    state.currentPageUrl = normalizedPageUrl;
    state.documentContentRevision += 1;
    state.cachedPageContentSnapshot = null;
    state.lastSentCandidateSignature = null;
    state.lastReportedPageDigestFingerprint = null;
    state.lastCandidateRegistrationGeneration = 0;
    state.lastCandidateRegistrationUrl = "";
    return true;
  }

  function markDocumentContentChanged() {
    state.documentContentRevision += 1;
    state.cachedPageContentSnapshot = null;
  }

  Object.assign(namespace, {
    constants,
    state,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
    advancePageGeneration,
    markDocumentContentChanged,
  });
})();
