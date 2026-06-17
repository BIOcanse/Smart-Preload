(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    hasActiveEditableFocus,
    sendCandidateLinks,
    reportPageDigest,
  } = namespace;

  function scheduleCandidateScan(options = {}) {
    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      return;
    }

    const delayMs = Math.max(0, Number(options.delayMs ?? constants.RESCAN_DELAY_MS) || 0);
    const force = options.force === true;
    const nextDueAt = Date.now() + delayMs;

    if (state.candidateScanTimerId && state.candidateScanDueAt <= nextDueAt) {
      state.candidateScanForce = state.candidateScanForce || force;
      return;
    }

    state.deferredScanWhileEditing = false;
    window.clearTimeout(state.candidateScanTimerId);
    state.candidateScanDueAt = nextDueAt;
    state.candidateScanForce = force;
    state.candidateScanTimerId = window.setTimeout(() => {
      const shouldForce = state.candidateScanForce;
      state.candidateScanTimerId = null;
      state.candidateScanDueAt = 0;
      state.candidateScanForce = false;
      void sendCandidateLinks({ force: shouldForce });
    }, delayMs);
  }

  function schedulePageDigestReport() {
    if (hasActiveEditableFocus()) {
      state.deferredPageDigestWhileEditing = true;
      return;
    }

    state.deferredPageDigestWhileEditing = false;
    window.clearTimeout(state.pageDigestTimerId);
    state.pageDigestTimerId = window.setTimeout(() => {
      void reportPageDigest();
    }, constants.PAGE_DIGEST_DELAY_MS);
  }

  Object.assign(namespace, {
    scheduleCandidateScan,
    schedulePageDigestReport,
  });
})();
