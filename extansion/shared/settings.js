(() => {
  const {
    cloneSettings,
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const {
    SETTINGS_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    PRELOAD_RULE_CARD_IDS,
    TRACKING_RULE_CARD_IDS,
    RULE_CARD_IDS,
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    PROXY_SKIP_MODE_VALUES,
    LANGUAGE_MODE_VALUES,
    PROXY_SKIP_MODE_OPTIONS,
    TRANSITION_WINDOW_VALUES,
    TRANSITION_WINDOW_OPTIONS,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
    AI_MODEL_CATALOG,
    RULE_OPERATOR_OPTIONS,
    RULE_CARD_SCHEMA,
    refreshLocalizedText,
    localize,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;
  const {
    isRuleCardEnabled,
    compareRuleValues,
    evaluateRuleCardMetric,
  } = globalThis.ZeroLatencySettingsRules;
  const {
    normalizeProxySkipMode,
    normalizeProxySkipSettings,
    normalizeProxySkipRules,
    shouldSkipProxyRuleUrl,
    doesProxySkipRuleMatchUrl,
  } = globalThis.ZeroLatencySettingsProxySkip;
  const {
    normalizeAiProviderId,
    getAiModelInfo,
    getAiProviderModels,
    getAiRequestParams,
    isAiPredictionConfigured,
  } = globalThis.ZeroLatencySettingsAi;
  const {
    detectDeviceProfile,
    getNavigatorSnapshot,
  } = globalThis.ZeroLatencySettingsEffective;
  const {
    normalizeStoredSettings,
    normalizeAppearanceSettings,
    normalizeLanguageMode,
    normalizeFullscreenPressurePolicy,
    normalizeTransitionWindowKey,
    isRealPreloadEnabled,
    isAllNativePreloadModeEnabled,
  } = globalThis.ZeroLatencySettingsNormalize;

  refreshLocalizedText();

  const MODE_LIMITS = {
    conservative: 2,
    balanced: 3,
    aggressive: 5,
  };

  const { resolveEffectiveSettings } = globalThis.ZeroLatencySettingsEffective.create({
    normalizeStoredSettings,
    isAiPredictionConfigured,
  });

  const { loadSettings, saveSettings } = globalThis.ZeroLatencySettingsStorage.create({
    normalizeStoredSettings,
  });

  globalThis.ZeroLatencySettings = {
    SETTINGS_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    PRELOAD_RULE_CARD_IDS,
    TRACKING_RULE_CARD_IDS,
    RULE_CARD_IDS,
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    PROXY_SKIP_MODE_VALUES,
    LANGUAGE_MODE_VALUES,
    PROXY_SKIP_MODE_OPTIONS,
    TRANSITION_WINDOW_VALUES,
    TRANSITION_WINDOW_OPTIONS,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
    AI_MODEL_CATALOG,
    RULE_OPERATOR_OPTIONS,
    RULE_CARD_SCHEMA,
    DEFAULT_SETTINGS,
    MODE_LIMITS,
    cloneSettings,
    mergeSettings,
    normalizeStoredSettings,
    normalizeAppearanceSettings,
    normalizeLanguageMode,
    isRuleCardEnabled,
    compareRuleValues,
    evaluateRuleCardMetric,
    normalizeFullscreenPressurePolicy,
    normalizeProxySkipMode,
    normalizeProxySkipSettings,
    normalizeProxySkipRules,
    isRealPreloadEnabled,
    isAllNativePreloadModeEnabled,
    shouldSkipProxyRuleUrl,
    doesProxySkipRuleMatchUrl,
    normalizeTransitionWindowKey,
    getAiModelInfo,
    getAiProviderModels,
    getAiRequestParams,
    isAiPredictionConfigured,
    detectDeviceProfile,
    resolveEffectiveSettings,
    getNavigatorSnapshot,
    refreshLocalizedText,
    loadSettings,
    saveSettings,
  };
})();
