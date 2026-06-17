(() => {
  const {
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const {
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    TRANSITION_WINDOW_VALUES,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizeFullscreenPressurePolicy(
    value,
    fallback = DEFAULT_SETTINGS.preloadWindow.fullscreenPressurePolicy
  ) {
    return FULLSCREEN_PRESSURE_POLICY_VALUES.includes(value) ? value : fallback;
  }

  function normalizeTransitionWindowKey(
    value,
    fallback = DEFAULT_SETTINGS.preloading.transitionWindowScope.windowKey
  ) {
    return TRANSITION_WINDOW_VALUES.includes(value) ? value : fallback;
  }

  function normalizeTransitionWindowScopeSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.transitionWindowScope, value);

    return {
      enabled: Boolean(mergedValue.enabled),
      windowKey: normalizeTransitionWindowKey(mergedValue.windowKey),
    };
  }

  function isRealPreloadEnabled(settings) {
    return settings?.preloading?.realPreloadEnabled === true;
  }

  function isAllNativePreloadModeEnabled(settings) {
    return !isRealPreloadEnabled(settings);
  }

  globalThis.ZeroLatencySettingsNormalizePreload = {
    normalizeFullscreenPressurePolicy,
    normalizeTransitionWindowKey,
    normalizeTransitionWindowScopeSettings,
    isRealPreloadEnabled,
    isAllNativePreloadModeEnabled,
  };
})();
