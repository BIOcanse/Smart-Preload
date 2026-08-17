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
    // 上面两个限的是**每批**工作量，不是积压。可编辑元素获得焦点期间消费者会直接返回
    // （scheduler.js 的 hasActiveEditableFocus 分支），而生产者 enqueueCandidateMutations
    // 无条件执行 —— 在 Gmail 写信、Google Docs 编辑的整个会话里积压单调增长，且队列里是
    // **强 DOM 引用**（含 mutation.removedNodes 捕获的已分离节点）。下面两个是积压上限，
    // 触顶时丢弃积压并改走一次全量重建，见 dropCandidateMutationBacklog。
    MAX_CANDIDATE_MUTATION_QUEUE: 5_000,
    MAX_CANDIDATE_DIRTY_ANCHORS: 2_000,
    BLANK_CLICK_RESOLUTION_TIMEOUT_MS: 500,
    CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS: 2500,
    HOVER_PRELOAD_DELAY_MS: 80,
    WATERFALL_BASELINE_MAX_UNLOCKED_MS: 2500,
    RESCAN_DELAY_MS: 700,
    ATTENTION_ACTIVITY_INTERVAL_MS: 15_000,
    ATTENTION_ACTIVITY_MIN_REPORT_INTERVAL_MS: 1_000,
    SPECULATION_RULES_ELEMENT_ID: "zero-latency-speculation-rules",
  };

  const state = {
    currentPageUrl: location.href,
    pageGeneration: 1,
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
    candidateFullReindexPending: false,
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
    state.cachedPageContentSnapshot = null;
    state.lastSentCandidateSignature = null;
    state.lastReportedPageDigestFingerprint = null;
    state.lastCandidateRegistrationGeneration = 0;
    state.lastCandidateRegistrationUrl = "";
    return true;
  }

  // markDocumentContentChanged() 已删除：它的全部作用是在每一批 DOM 变更上作废
  // cachedPageContentSnapshot，而页面摘要现在按生命周期事件构建（见 page-digest.js）。
  // documentContentRevision 一并删除 —— 它没有第二个消费方。
  Object.assign(namespace, {
    constants,
    state,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
    advancePageGeneration,
  });
})();
