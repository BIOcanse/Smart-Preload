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
    reportAttentionActivityToBackground,
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

  function buildAttentionActivitySnapshot() {
    const observedAtMs = Date.now();

    return {
      pageUrl: location.href,
      observedAt: new Date(observedAtMs).toISOString(),
      documentVisible: document.visibilityState === "visible" && document.hidden !== true,
      prerendering: isPassivePrerenderContext(),
      lastUserInputAt:
        state.lastUserInputAt > 0 ? new Date(state.lastUserInputAt).toISOString() : null,
      videoPlaybackActive: hasActiveVideoPlayback(),
      audioPlaybackActive: hasActiveAudioPlayback(),
    };
  }

  function recordUserInputForAttention() {
    state.lastUserInputAt = Date.now();
    void reportAttentionActivity({ throttle: true });
  }

  async function reportAttentionActivity(options = {}) {
    if (typeof reportAttentionActivityToBackground !== "function") {
      return;
    }

    const now = Date.now();

    if (
      options.throttle === true &&
      now - state.lastAttentionActivityReportedAt <
        constants.ATTENTION_ACTIVITY_MIN_REPORT_INTERVAL_MS
    ) {
      return;
    }

    state.lastAttentionActivityReportedAt = now;
    await reportAttentionActivityToBackground(buildAttentionActivitySnapshot());
  }

  function startAttentionActivityReporter() {
    if (state.attentionActivityTimerId) {
      return;
    }

    void reportAttentionActivity({ force: true });
    state.attentionActivityTimerId = window.setInterval(() => {
      void reportAttentionActivity({ force: true });
    }, constants.ATTENTION_ACTIVITY_INTERVAL_MS);
  }

  function hasActiveVideoPlayback() {
    const mediaElements = document.querySelectorAll("video,audio");
    const MediaElementCtor = globalThis.HTMLMediaElement;

    for (const mediaElement of mediaElements) {
      if (
        (typeof MediaElementCtor !== "function" ||
          mediaElement instanceof MediaElementCtor) &&
        mediaElement.paused === false &&
        mediaElement.ended === false &&
        mediaElement.readyState > 1 &&
        mediaElement.tagName?.toLowerCase() === "video"
      ) {
        return true;
      }
    }

    return false;
  }

  function hasActiveAudioPlayback() {
    const mediaElements = document.querySelectorAll("video,audio");
    const MediaElementCtor = globalThis.HTMLMediaElement;

    for (const mediaElement of mediaElements) {
      if (
        (typeof MediaElementCtor !== "function" ||
          mediaElement instanceof MediaElementCtor) &&
        mediaElement.paused === false &&
        mediaElement.ended === false &&
        mediaElement.readyState > 1 &&
        mediaElement.tagName?.toLowerCase() === "audio"
      ) {
        return true;
      }
    }

    return false;
  }

  function bindNavigationContentEvents() {
    document.addEventListener(
      "mousedown",
      (event) => {
        recordUserInputForAttention();
        void namespace.primeSourcePageForNavigation(event);
      },
      true
    );

    document.addEventListener(
      "mousemove",
      () => {
        recordUserInputForAttention();
      },
      {
        capture: true,
        passive: true,
      }
    );

    document.addEventListener(
      "wheel",
      () => {
        recordUserInputForAttention();
      },
      {
        capture: true,
        passive: true,
      }
    );

    document.addEventListener(
      "keydown",
      () => {
        recordUserInputForAttention();
      },
      true
    );

    document.addEventListener(
      "touchstart",
      () => {
        recordUserInputForAttention();
      },
      {
        capture: true,
        passive: true,
      }
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
        void reportAttentionActivity({ force: true });
        return;
      }

      void reportAttentionActivity({ force: true });
      scheduleCandidateScan();
      schedulePageDigestReport();
    });

    document.addEventListener("visibilitychange", () => {
      void reportAttentionActivity({ force: true });
    });

    document.addEventListener(
      "play",
      () => {
        void reportAttentionActivity({ force: true });
      },
      true
    );
    document.addEventListener(
      "playing",
      () => {
        void reportAttentionActivity({ force: true });
      },
      true
    );
    document.addEventListener(
      "pause",
      () => {
        void reportAttentionActivity({ force: true });
      },
      true
    );
    document.addEventListener(
      "ended",
      () => {
        void reportAttentionActivity({ force: true });
      },
      true
    );

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
    startAttentionActivityReporter();
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
        return;
      }

      if (message?.type === "preload:apply-speculation-rules") {
        applySpeculationRules({
          prerenderTargets: message.prerenderTargets ?? [],
          prefetchTargets: message.prefetchTargets ?? [],
        });
      }
    });
  }

  Object.assign(namespace, {
    bindNavigationContentEvents,
    scheduleCandidateScan,
    schedulePageDigestReport,
    buildAttentionActivitySnapshot,
  });
})();
