(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    hasActiveEditableFocus,
    isPassivePrerenderContext,
    isExtensionOnlyMutation,
    resetWaterfallBaseline,
    sendCandidateLinks,
    reportPageDigest,
    applySpeculationRules,
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

  function bindNavigationContentEvents() {
    document.addEventListener(
      "mousedown",
      (event) => {
        void namespace.primeSourcePageForNavigation(event);
      },
      true
    );

    document.addEventListener(
      "click",
      (event) => {
        void namespace.handleClick(event);
      },
      true
    );

    document.addEventListener(
      "auxclick",
      (event) => {
        void namespace.handleAuxClick(event);
      },
      true
    );

    document.addEventListener("DOMContentLoaded", () => {
      scheduleCandidateScan({
        delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
      });
      schedulePageDigestReport();
    });

    window.addEventListener("load", () => {
      scheduleCandidateScan({
        delayMs: constants.RESCAN_DELAY_MS,
        force: true,
      });
      schedulePageDigestReport();
    });

    document.addEventListener("prerenderingchange", () => {
      if (isPassivePrerenderContext()) {
        return;
      }

      scheduleCandidateScan();
      schedulePageDigestReport();
    });

    document.addEventListener("focusin", () => {
      if (hasActiveEditableFocus()) {
        window.clearTimeout(state.candidateScanTimerId);
        state.candidateScanTimerId = null;
        state.candidateScanDueAt = 0;
        state.candidateScanForce = false;
        window.clearTimeout(state.pageDigestTimerId);
      }
    });

    document.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (state.deferredScanWhileEditing && !hasActiveEditableFocus()) {
          state.deferredScanWhileEditing = false;
          scheduleCandidateScan();
        }
        if (state.deferredPageDigestWhileEditing && !hasActiveEditableFocus()) {
          state.deferredPageDigestWhileEditing = false;
          schedulePageDigestReport();
        }
      }, 0);
    });

    bindRuntimeMessages();
    startMutationObserverWhenReady(createMutationObserver());
  }

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

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "preload:collect-candidates") {
        scheduleCandidateScan({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
          force: true,
        });
        return;
      }

      if (message?.type === "preload:clear-speculation-rules") {
        applySpeculationRules({
          prerenderTargets: [],
          prefetchTargets: [],
        });
      }
    });
  }

  Object.assign(namespace, {
    bindNavigationContentEvents,
    scheduleCandidateScan,
    schedulePageDigestReport,
  });
})();
