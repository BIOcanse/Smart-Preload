(() => {
  const {
    clamp,
    isPlainObject,
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const {
    SETTINGS_STORAGE_VERSION,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;
  const {
    derivePreloadCapFromRuleCard,
    deriveSiteSelectionLimitFromRuleCard,
  } = globalThis.ZeroLatencySettingsRules;
  const {
    normalizeProxySkipSettings,
  } = globalThis.ZeroLatencySettingsProxySkip;
  const {
    normalizeAiPredictionSettings,
  } = globalThis.ZeroLatencySettingsAi;
  const {
    normalizeAppearanceSettings,
    normalizeLanguageMode,
    normalizeLayoutSettings,
  } = globalThis.ZeroLatencySettingsNormalizeAppearanceLayout;
  const {
    normalizeFullscreenPressurePolicy,
    normalizeTransitionWindowKey,
    normalizeTransitionWindowScopeSettings,
    isRealPreloadEnabled,
    isAllNativePreloadModeEnabled,
  } = globalThis.ZeroLatencySettingsNormalizePreload;
  const {
    normalizePreloadSchedulerSettings,
  } = globalThis.ZeroLatencySettingsNormalizeScheduler;

  function normalizeStoredSettings(value) {
    const normalized = mergeSettings(DEFAULT_SETTINGS, value);
    normalized.version = SETTINGS_STORAGE_VERSION;
    normalized.preloading.mode = ["conservative", "balanced", "aggressive"].includes(
      normalized.preloading.mode
    )
      ? normalized.preloading.mode
      : DEFAULT_SETTINGS.preloading.mode;
    normalized.appearance = normalizeAppearanceSettings(normalized.appearance);
    normalized.tracking.excludeHttpPages = normalized.tracking.excludeHttpPages !== false;
    normalized.tracking.excludeLocalPages = normalized.tracking.excludeLocalPages !== false;
    normalized.tracking.excludePrivateNetworkPages =
      normalized.tracking.excludePrivateNetworkPages !== false;
    normalized.preloading.transitionWindowScope = normalizeTransitionWindowScopeSettings(
      normalized.preloading.transitionWindowScope
    );
    normalized.preloading.scheduler = normalizePreloadSchedulerSettings(
      normalized.preloading.scheduler
    );
    normalized.preloading.aiPrediction = normalizeAiPredictionSettings(
      normalized.preloading.aiPrediction
    );
    delete normalized.preloading.modelManager;
    normalized.preloading.ignoreWaterfallDynamicLinks =
      normalized.preloading.ignoreWaterfallDynamicLinks !== false;
    normalized.preloading.interactionPreloadEnabled =
      normalized.preloading.interactionPreloadEnabled !== false;
    normalized.preloading.skipSensitivePages =
      normalized.preloading.skipSensitivePages !== false;
    normalized.preloading.excludeIncognitoWindows =
      normalized.preloading.excludeIncognitoWindows !== false;
    normalized.preloading.realPreloadEnabled =
      normalized.preloading.realPreloadEnabled === true;
    delete normalized.preloading.allNativePreloadMode;
    normalized.preloading.proxySkip = normalizeProxySkipSettings(
      normalized.preloading.proxySkip
    );
    delete normalized.preloading.crossSiteCurrentTabSwap;
    normalized.preloadWindow.watchdogIntervalSeconds = clamp(
      normalized.preloadWindow.watchdogIntervalSeconds,
      1,
      10,
      DEFAULT_SETTINGS.preloadWindow.watchdogIntervalSeconds
    );
    normalized.preloadWindow.fullscreenPressurePolicy = normalizeFullscreenPressurePolicy(
      normalized.preloadWindow.fullscreenPressurePolicy
    );
    normalized.experiments.crossSiteCurrentTabSwap =
      normalized.preloading.realPreloadEnabled === true &&
      normalized.experiments.crossSiteCurrentTabSwap === true;
    normalized.diagnostics = {
      enabled: normalized.diagnostics?.enabled === true,
    };
    normalized.layout = normalizeLayoutSettings(
      isPlainObject(value?.layout) ? value.layout : normalized.layout
    );
    normalized.preloading.nativeMaxPreloadsPerSource = derivePreloadCapFromRuleCard(
      normalized.layout.ruleCards.items?.nativePerPagePreloadLimit,
      normalized.preloading.nativeMaxPreloadsPerSource
    );
    normalized.preloading.maxTabsPerSource = derivePreloadCapFromRuleCard(
      normalized.layout.ruleCards.items?.perPagePreloadLimit,
      normalized.preloading.maxTabsPerSource
    );
    normalized.preloading.siteSelectionLimit = deriveSiteSelectionLimitFromRuleCard(
      normalized.layout.ruleCards.items?.highWeightRank,
      normalized.preloading.siteSelectionLimit
    );
    normalized.preloading.siteSelectionLimit = clamp(
      normalized.preloading.siteSelectionLimit,
      1,
      20,
      DEFAULT_SETTINGS.preloading.siteSelectionLimit
    );
    normalized.preloading.tabSiteSelectionLimit = deriveSiteSelectionLimitFromRuleCard(
      normalized.layout.ruleCards.items?.highWeightRankTab,
      normalized.preloading.tabSiteSelectionLimit
    );
    normalized.preloading.tabSiteSelectionLimit = clamp(
      normalized.preloading.tabSiteSelectionLimit,
      1,
      20,
      DEFAULT_SETTINGS.preloading.tabSiteSelectionLimit
    );
    return normalized;
  }

  globalThis.ZeroLatencySettingsNormalize = {
    normalizeStoredSettings,
    normalizeAppearanceSettings,
    normalizeLanguageMode,
    normalizeLayoutSettings,
    normalizeFullscreenPressurePolicy,
    normalizeTransitionWindowKey,
    normalizeTransitionWindowScopeSettings,
    isRealPreloadEnabled,
    isAllNativePreloadModeEnabled,
    normalizePreloadSchedulerSettings,
  };
})();
