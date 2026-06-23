(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    isPassivePrerenderContext,
    reportAttentionActivityToBackground,
  } = namespace;

  function buildAttentionActivitySnapshot() {
    const observedAtMs = Date.now();

    return {
      pageUrl: location.href,
      observedAt: new Date(observedAtMs).toISOString(),
      documentVisible: document.visibilityState === "visible" && document.hidden !== true,
      prerendering: isPassivePrerenderContext(),
      lastUserInputAt:
        state.lastUserInputAt > 0 ? new Date(state.lastUserInputAt).toISOString() : null,
      lastLinkInteractionAt:
        state.lastLinkInteractionAt > 0
          ? new Date(state.lastLinkInteractionAt).toISOString()
          : null,
      videoPlaybackActive: hasActiveVideoPlayback(),
      audioPlaybackActive: hasActiveAudioPlayback(),
    };
  }

  function recordUserInputForAttention() {
    state.lastUserInputAt = Date.now();
    void reportAttentionActivity({ throttle: true });
  }

  function recordLinkInteractionForAttention() {
    const now = Date.now();
    state.lastUserInputAt = now;
    state.lastLinkInteractionAt = now;
    void reportAttentionActivity();
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

  Object.assign(namespace, {
    buildAttentionActivitySnapshot,
    recordUserInputForAttention,
    recordLinkInteractionForAttention,
    reportAttentionActivity,
    startAttentionActivityReporter,
  });
})();
