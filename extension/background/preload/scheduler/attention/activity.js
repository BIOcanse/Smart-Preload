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
      poolDurationMs: Number(schedulerSettings.attentionPoolMinutes) * 60 * 1000,
      segmentDurationMs: Number(schedulerSettings.attentionSegmentSeconds) * 1000,
      maxObservableGapMs: Number(schedulerSettings.attentionMaxObservableGapSeconds) * 1000,
      inputWindowMs: Number(schedulerSettings.attentionInputWindowSeconds) * 1000,
      mediaPlaybackWeight: Number(schedulerSettings.attentionMediaPlaybackWeight),
      audioPlaybackWeight: Number(schedulerSettings.attentionAudioPlaybackWeight),
      linkSoftDecayMs:
        Number(schedulerSettings.attentionLinkInteractionSoftDecaySeconds) * 1000,
      linkSoftDecayWeight: Number(
        schedulerSettings.attentionLinkInteractionSoftDecayWeight
      ),
      linkHardDecayMs:
        Number(schedulerSettings.attentionLinkInteractionHardDecaySeconds) * 1000,
      linkHardDecayWeight: Number(
        schedulerSettings.attentionLinkInteractionHardDecayWeight
      ),
      linkZeroMs: Number(schedulerSettings.attentionLinkInteractionZeroSeconds) * 1000,
      siteShareRatio: Number(schedulerSettings.attentionSiteShareRatio),
      ...options,
      enabled: schedulerSettings.attentionPoolEnabled !== false && options.enabled !== false,
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
    const linkInteraction = resolveLinkInteractionMultiplier(
      rawActivity,
      observedAtMs,
      resolvedOptions
    );
    const baseActivity = resolveBaseAttentionActivity(
      rawActivity,
      observedAtMs,
      resolvedOptions
    );

    if (baseActivity.weight <= 0 || linkInteraction.multiplier <= 0) {
      return {
        kind: linkInteraction.multiplier <= 0 ? "link-inactive" : baseActivity.kind,
        weight: 0,
        expiresAt: null,
      };
    }

    return {
      kind:
        linkInteraction.multiplier < 1
          ? `${baseActivity.kind}:link-decayed`
          : baseActivity.kind,
      weight: baseActivity.weight * linkInteraction.multiplier,
      expiresAt: buildCombinedExpiresAt(baseActivity.expiresAtMs, linkInteraction.expiresAtMs),
    };
  }

  function resolveBaseAttentionActivity(rawActivity, observedAtMs, resolvedOptions) {
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
        expiresAtMs: userInputExpiresAtMs,
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
        expiresAtMs: null,
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
        expiresAtMs: null,
      };
    }

    return {
      kind: "inactive",
      weight: 0,
      expiresAtMs: null,
    };
  }

  function resolveLinkInteractionMultiplier(rawActivity, observedAtMs, resolvedOptions) {
    const lastLinkInteractionAtMs = parseTimestampMs(rawActivity.lastLinkInteractionAt);

    if (lastLinkInteractionAtMs === null) {
      return {
        multiplier: 0,
        expiresAtMs: null,
      };
    }

    const ageMs = Math.max(0, observedAtMs - lastLinkInteractionAtMs);
    const softDecayMs = resolvedOptions.linkSoftDecayMs;
    const hardDecayMs = Math.max(softDecayMs, resolvedOptions.linkHardDecayMs);
    const zeroMs = Math.max(hardDecayMs, resolvedOptions.linkZeroMs);

    if (ageMs >= zeroMs) {
      return {
        multiplier: 0,
        expiresAtMs: null,
      };
    }

    if (ageMs >= hardDecayMs) {
      return {
        multiplier: resolvedOptions.linkHardDecayWeight,
        expiresAtMs: lastLinkInteractionAtMs + zeroMs,
      };
    }

    if (ageMs >= softDecayMs) {
      return {
        multiplier: resolvedOptions.linkSoftDecayWeight,
        expiresAtMs: lastLinkInteractionAtMs + hardDecayMs,
      };
    }

    return {
      multiplier: 1,
      expiresAtMs: lastLinkInteractionAtMs + softDecayMs,
    };
  }

  function buildCombinedExpiresAt(baseExpiresAtMs, linkExpiresAtMs) {
    const candidates = [baseExpiresAtMs, linkExpiresAtMs].filter((value) =>
      Number.isFinite(value)
    );

    if (candidates.length === 0) {
      return null;
    }

    return new Date(Math.min(...candidates)).toISOString();
  }

  globalThis.ZeroLatencyPreloadAttentionActivity = {
    buildPreloadAttentionRuntimeOptions,
    resolveAttentionActivity,
  };
})();
