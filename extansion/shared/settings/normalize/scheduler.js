(() => {
  const {
    clamp,
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizePreloadSchedulerSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.scheduler, value);

    return {
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
      attentionPoolHours: clamp(
        mergedValue.attentionPoolHours,
        1,
        24,
        DEFAULT_SETTINGS.preloading.scheduler.attentionPoolHours
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
        10,
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
