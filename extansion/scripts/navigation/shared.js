(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  const constants = {
    MAX_CANDIDATE_LINKS: 40,
    MAX_TEXT_DIGEST_CHARS: 2200,
    MAX_CANDIDATE_TEXT_CHARS: 240,
    MAX_NEARBY_TEXT_CHARS: 320,
    EARLY_LINK_RESCAN_DELAY_MS: 120,
    LINK_STABILITY_POLL_MS: 120,
    LINK_STABILITY_MAX_WAIT_MS: 900,
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
    lastLocationHref: location.href,
    candidateScanTimerId: null,
    candidateScanDueAt: 0,
    candidateScanForce: false,
    candidateScanInFlight: false,
    candidateScanPending: false,
    pageDigestTimerId: null,
    observerStarted: false,
    observerReadinessListenerStarted: false,
    deferredScanWhileEditing: false,
    deferredPageDigestWhileEditing: false,
    lastSentCandidateSignature: null,
    fixedCandidateUrlSet: null,
    waterfallBaselineStartedAt: 0,
    waterfallBaselineLocked: false,
    ignoreWaterfallDynamicLinks: true,
    lastReportedPageDigestFingerprint: null,
    attentionActivityTimerId: null,
    lastUserInputAt: 0,
    lastAttentionActivityReportedAt: 0,
    lastAttentionActivitySignature: "",
    hoverPreloadIntent: null,
    hoverPreloadSequence: 0,
    scheduledPrerenderTargets: [],
    scheduledPrefetchTargets: [],
    interactionPrerenderTargets: [],
    interactionPrefetchTargets: [],
  };

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  Object.assign(namespace, {
    constants,
    state,
    sleep,
  });
})();
