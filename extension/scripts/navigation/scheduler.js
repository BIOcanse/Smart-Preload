(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    hasActiveEditableFocus,
    sendCandidateLinks,
    reportPageDigest,
    collectPageContentSnapshot,
    processCandidateMutationWorkBatch,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
  } = namespace;

  function scheduleCandidateScan(options = {}) {
    const includePageDigest = options.includePageDigest === true;

    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      state.deferredPageDigestWhileEditing =
        state.deferredPageDigestWhileEditing || includePageDigest;
      return;
    }

    const delayMs = Math.max(0, Number(options.delayMs ?? constants.RESCAN_DELAY_MS) || 0);
    const now = Date.now();
    state.deferredScanWhileEditing = false;
    state.candidateScanForce = state.candidateScanForce || options.force === true;
    state.candidateScanIncludePageDigest =
      state.candidateScanIncludePageDigest || includePageDigest;

    if (state.candidateScanWorkInProgress) {
      return;
    }

    if (state.candidateScanCycleStartedAt === null) {
      state.candidateScanCycleStartedAt = now;
      state.candidateScanMaxWaitTimerId = window.setTimeout(
        beginCandidateScanWork,
        constants.CANDIDATE_SCAN_MAX_WAIT_MS
      );
    }

    window.clearTimeout(state.candidateScanTimerId);
    state.candidateScanDueAt = now + delayMs;
    state.candidateScanTimerId = window.setTimeout(beginCandidateScanWork, delayMs);
  }

  function schedulePageDigestReport() {
    scheduleCandidateScan({
      delayMs: constants.PAGE_DIGEST_DELAY_MS,
      includePageDigest: true,
    });
  }

  function beginCandidateScanWork() {
    clearCandidateScanTimers();

    if (state.candidateScanWorkInProgress) {
      return;
    }

    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      state.deferredPageDigestWhileEditing =
        state.deferredPageDigestWhileEditing || state.candidateScanIncludePageDigest;
      state.candidateScanCycleStartedAt = null;
      return;
    }

    state.candidateScanWorkInProgress = true;
    requestCandidateScanIdleBatch();
  }

  function requestCandidateScanIdleBatch() {
    if (state.candidateScanIdleCallbackId !== null) {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      state.candidateScanIdleCallbackKind = "idle";
      state.candidateScanIdleCallbackId = window.requestIdleCallback(
        runCandidateScanIdleBatch,
        { timeout: constants.CANDIDATE_IDLE_TIMEOUT_MS }
      );
      return;
    }

    state.candidateScanIdleCallbackKind = "timer";
    state.candidateScanIdleCallbackId = window.setTimeout(runCandidateScanIdleBatch, 0);
  }

  function runCandidateScanIdleBatch() {
    state.candidateScanIdleCallbackId = null;
    state.candidateScanIdleCallbackKind = "";

    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      state.deferredPageDigestWhileEditing =
        state.deferredPageDigestWhileEditing || state.candidateScanIncludePageDigest;
      state.candidateScanWorkInProgress = false;
      state.candidateScanCycleStartedAt = null;
      return;
    }

    const batchResult = processCandidateMutationWorkBatch();

    if (batchResult.hasPendingWork) {
      requestCandidateScanIdleBatch();
      return;
    }

    const force = state.candidateScanForce;
    const includePageDigest = state.candidateScanIncludePageDigest;
    state.candidateScanForce = false;
    state.candidateScanIncludePageDigest = false;
    state.candidateScanWorkInProgress = false;
    state.candidateScanCycleStartedAt = null;
    void completeCandidateScanCycle({ force, includePageDigest });
  }

  async function completeCandidateScanCycle({ force, includePageDigest }) {
    if (namespace.synchronizeCurrentPageGeneration?.() === true) {
      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
        includePageDigest: true,
      });
      return;
    }

    const pageToken = capturePageGenerationToken();

    if (!isPageGenerationTokenCurrent(pageToken)) {
      return;
    }

    const pageSnapshot = collectPageContentSnapshot();
    const pendingWork = [
      sendCandidateLinks({
        force,
        pageSnapshot,
        pageToken,
      }),
    ];

    if (includePageDigest) {
      pendingWork.push(
        reportPageDigest({
          pageSnapshot,
          pageToken,
        })
      );
    }

    await Promise.allSettled(pendingWork);
  }

  function cancelScheduledNavigationScan(options = {}) {
    clearCandidateScanTimers();
    cancelCandidateScanIdleBatch();
    state.candidateScanWorkInProgress = false;
    state.candidateScanCycleStartedAt = null;

    if (options.preserveRequestedWork === true) {
      return;
    }

    state.candidateScanForce = false;
    state.candidateScanIncludePageDigest = false;
  }

  function clearCandidateScanTimers() {
    window.clearTimeout(state.candidateScanTimerId);
    window.clearTimeout(state.candidateScanMaxWaitTimerId);
    state.candidateScanTimerId = null;
    state.candidateScanMaxWaitTimerId = null;
    state.candidateScanDueAt = 0;
  }

  function cancelCandidateScanIdleBatch() {
    if (state.candidateScanIdleCallbackId === null) {
      return;
    }

    if (
      state.candidateScanIdleCallbackKind === "idle" &&
      typeof window.cancelIdleCallback === "function"
    ) {
      window.cancelIdleCallback(state.candidateScanIdleCallbackId);
    } else {
      window.clearTimeout(state.candidateScanIdleCallbackId);
    }

    state.candidateScanIdleCallbackId = null;
    state.candidateScanIdleCallbackKind = "";
  }

  Object.assign(namespace, {
    scheduleCandidateScan,
    schedulePageDigestReport,
    cancelScheduledNavigationScan,
  });
})();
