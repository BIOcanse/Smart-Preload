(function () {
  const {
    resolvePreloadAttentionOptions,
    parseTimestampMs,
  } = globalThis.ZeroLatencyPreloadAttentionOptions;

  function buildPreloadAttentionRuntimeOptions(options = {}) {
    const effectiveSettings =
      globalThis.getEffectiveExtensionSettings?.() ??
      null;
    const schedulerSettings =
      effectiveSettings?.preloading?.effectivePreloadScheduler ??
      effectiveSettings?.preloading?.scheduler ??
      globalThis.ZeroLatencySettings?.DEFAULT_SETTINGS?.preloading?.scheduler ??
      {};

    return {
      poolDurationMs: Number(schedulerSettings.attentionPoolHours) * 60 * 60 * 1000,
      segmentDurationMs: Number(schedulerSettings.attentionSegmentSeconds) * 1000,
      maxObservableGapMs: Number(schedulerSettings.attentionMaxObservableGapSeconds) * 1000,
      inputWindowMs: Number(schedulerSettings.attentionInputWindowSeconds) * 1000,
      mediaPlaybackWeight: Number(schedulerSettings.attentionMediaPlaybackWeight),
      audioPlaybackWeight: Number(schedulerSettings.attentionAudioPlaybackWeight),
      ...options,
    };
  }

  function resolveAttentionActivity(rawActivity, options = {}) {
    const resolvedOptions = resolvePreloadAttentionOptions(options);

    if (!rawActivity || typeof rawActivity !== "object") {
      return {
        kind: "inactive",
        weight: 0,
        expiresAt: null,
      };
    }

    if (rawActivity.documentVisible !== true || rawActivity.prerendering === true) {
      return {
        kind: "hidden",
        weight: 0,
        expiresAt: null,
      };
    }

    const observedAtMs = parseTimestampMs(rawActivity.observedAt) ?? Date.now();
    const lastUserInputAtMs = parseTimestampMs(rawActivity.lastUserInputAt);
    const userInputExpiresAtMs =
      lastUserInputAtMs === null
        ? null
        : lastUserInputAtMs + resolvedOptions.inputWindowMs;
    const hasRecentUserInput =
      userInputExpiresAtMs !== null && observedAtMs <= userInputExpiresAtMs;

    if (hasRecentUserInput) {
      return {
        kind: "user-input",
        weight: 1,
        expiresAt: new Date(userInputExpiresAtMs).toISOString(),
      };
    }

    if (
      (rawActivity.videoPlaybackActive === true ||
        rawActivity.mediaPlaybackKind === "video" ||
        rawActivity.mediaPlaybackActive === true) &&
      resolvedOptions.mediaPlaybackWeight > 0
    ) {
      return {
        kind: "video-playback",
        weight: resolvedOptions.mediaPlaybackWeight,
        expiresAt: null,
      };
    }

    if (
      (rawActivity.audioPlaybackActive === true ||
        rawActivity.mediaPlaybackKind === "audio") &&
      resolvedOptions.audioPlaybackWeight > 0
    ) {
      return {
        kind: "audio-playback",
        weight: resolvedOptions.audioPlaybackWeight,
        expiresAt: null,
      };
    }

    return {
      kind: "inactive",
      weight: 0,
      expiresAt: null,
    };
  }

  globalThis.ZeroLatencyPreloadAttentionActivity = {
    buildPreloadAttentionRuntimeOptions,
    resolveAttentionActivity,
  };
})();
