(() => {
  const {
    clamp,
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizePreloadSchedulerSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.scheduler, value);
    const attentionLinkSoftDecaySeconds = clamp(
      mergedValue.attentionLinkInteractionSoftDecaySeconds,
      10,
      3600,
      DEFAULT_SETTINGS.preloading.scheduler.attentionLinkInteractionSoftDecaySeconds
    );
    const attentionLinkHardDecaySeconds = clamp(
      mergedValue.attentionLinkInteractionHardDecaySeconds,
      attentionLinkSoftDecaySeconds,
      3600,
      DEFAULT_SETTINGS.preloading.scheduler.attentionLinkInteractionHardDecaySeconds
    );
    const attentionLinkZeroSeconds = clamp(
      mergedValue.attentionLinkInteractionZeroSeconds,
      attentionLinkHardDecaySeconds,
      7200,
      DEFAULT_SETTINGS.preloading.scheduler.attentionLinkInteractionZeroSeconds
    );

    return {
      attentionPoolEnabled: mergedValue.attentionPoolEnabled !== false,
      nativeTotalMin: clamp(
        mergedValue.nativeTotalMin,
        1,
        64,
        DEFAULT_SETTINGS.preloading.scheduler.nativeTotalMin
      ),
      nativeTotalMax: clampSchedulerMax(
        mergedValue.nativeTotalMax,
        mergedValue.nativeTotalMin,
        DEFAULT_SETTINGS.preloading.scheduler.nativeTotalMax,
        128
      ),
      nativeHalfLifeTabs: clamp(
        mergedValue.nativeHalfLifeTabs,
        1,
        100,
        DEFAULT_SETTINGS.preloading.scheduler.nativeHalfLifeTabs
      ),
      tabTotalMin: clamp(
        mergedValue.tabTotalMin,
        1,
        64,
        DEFAULT_SETTINGS.preloading.scheduler.tabTotalMin
      ),
      tabTotalMax: clampSchedulerMax(
        mergedValue.tabTotalMax,
        mergedValue.tabTotalMin,
        DEFAULT_SETTINGS.preloading.scheduler.tabTotalMax,
        64
      ),
      tabHalfLifeTabs: clamp(
        mergedValue.tabHalfLifeTabs,
        1,
        100,
        DEFAULT_SETTINGS.preloading.scheduler.tabHalfLifeTabs
      ),
      attentionPoolMinutes: clamp(
        mergedValue.attentionPoolMinutes,
        5,
        1440,
        DEFAULT_SETTINGS.preloading.scheduler.attentionPoolMinutes
      ),
      attentionSegmentSeconds: clamp(
        mergedValue.attentionSegmentSeconds,
        10,
        600,
        DEFAULT_SETTINGS.preloading.scheduler.attentionSegmentSeconds
      ),
      attentionMaxObservableGapSeconds: clamp(
        mergedValue.attentionMaxObservableGapSeconds,
        10,
        600,
        DEFAULT_SETTINGS.preloading.scheduler.attentionMaxObservableGapSeconds
      ),
      attentionInputWindowSeconds: clamp(
        mergedValue.attentionInputWindowSeconds,
        5,
        600,
        DEFAULT_SETTINGS.preloading.scheduler.attentionInputWindowSeconds
      ),
      attentionMediaPlaybackWeight: clampNumber(
        mergedValue.attentionMediaPlaybackWeight,
        0,
        1,
        DEFAULT_SETTINGS.preloading.scheduler.attentionMediaPlaybackWeight
      ),
      attentionAudioPlaybackWeight: clampNumber(
        mergedValue.attentionAudioPlaybackWeight,
        0,
        1,
        DEFAULT_SETTINGS.preloading.scheduler.attentionAudioPlaybackWeight
      ),
      attentionLinkInteractionSoftDecaySeconds: attentionLinkSoftDecaySeconds,
      attentionLinkInteractionSoftDecayWeight: clampNumber(
        mergedValue.attentionLinkInteractionSoftDecayWeight,
        0,
        1,
        DEFAULT_SETTINGS.preloading.scheduler.attentionLinkInteractionSoftDecayWeight
      ),
      attentionLinkInteractionHardDecaySeconds: attentionLinkHardDecaySeconds,
      attentionLinkInteractionHardDecayWeight: clampNumber(
        mergedValue.attentionLinkInteractionHardDecayWeight,
        0,
        1,
        DEFAULT_SETTINGS.preloading.scheduler.attentionLinkInteractionHardDecayWeight
      ),
      attentionLinkInteractionZeroSeconds: attentionLinkZeroSeconds,
      attentionSiteShareRatio: clampNumber(
        mergedValue.attentionSiteShareRatio,
        0,
        1,
        DEFAULT_SETTINGS.preloading.scheduler.attentionSiteShareRatio
      ),
    };
  }

  function clampNumber(value, min, max, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, numericValue));
  }

  function clampSchedulerMax(value, minValue, fallback, hardMax) {
    const normalizedMin = clamp(minValue, 1, hardMax, 1);
    return clamp(value, normalizedMin, hardMax, Math.max(normalizedMin, fallback));
  }

  globalThis.ZeroLatencySettingsNormalizeScheduler = {
    normalizePreloadSchedulerSettings,
    clampNumber,
    clampSchedulerMax,
  };
})();
