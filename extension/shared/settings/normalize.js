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
    migrateStoredSettingsToCurrentVersion,
  } = globalThis.ZeroLatencySettingsMigrations;
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
    const migratedValue = migrateStoredSettingsToCurrentVersion(value);
    const normalized = mergeSettings(DEFAULT_SETTINGS, migratedValue);
    normalized.version = SETTINGS_STORAGE_VERSION;
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
    // 三个「设计过但一根线没接」的特性骨架，2026-08-02 按维护者裁定删除。
    //
    // 它们既无行为消费方也无 UI 控件，却被永久持久化；`preloading.mode` 还要在**每次
    // 加载**时对 ["conservative","balanced","aggressive"] 校验一遍。
    //
    // 必须显式 delete：mergeSettings 的语义是「base 侧没有该键就整体覆盖」，
    // 光从 DEFAULT_SETTINGS 里移除并不会让旧存储里的键消失。同上一行的 modelManager。
    delete normalized.automaticDeviceTuning;
    delete normalized.preloading.mode;
    delete normalized.preloadWindow?.systemLevelHiding;
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
    normalized.preloading.realPreloadRiskAcknowledged =
      normalized.preloading.realPreloadRiskAcknowledged === true;
    delete normalized.preloading.allNativePreloadMode;
    normalized.preloading.proxySkip = normalizeProxySkipSettings(
      normalized.preloading.proxySkip
    );
    delete normalized.preloading.crossSiteCurrentTabSwap;
    normalized.preloadWindow.watchdogIntervalSeconds = clamp(
      normalized.preloadWindow.watchdogIntervalSeconds,
      30,
      300,
      DEFAULT_SETTINGS.preloadWindow.watchdogIntervalSeconds
    );
    normalized.preloadWindow.fullscreenPressurePolicy = normalizeFullscreenPressurePolicy(
      normalized.preloadWindow.fullscreenPressurePolicy
    );
    // 只规范化类型，不与 realPreloadEnabled 联动。
    //
    // 此前这里是 `realPreloadEnabled === true && crossSiteCurrentTabSwap === true`，
    // 于是关掉 Real Preload 会把用户的实验选择**永久写成 false**——再打开也回不来。
    // 而 `preload/prediction/strategy/flags.js:8-12` 的
    // isCrossSiteCurrentTabSwapStrategyEnabled 本来就在**使用点**同时要求
    // supportsHiddenTabPreloadStrategy（其中 all-native 模式即 realPreloadEnabled 为假时
    // 直接返回 false），所以这里的联动对实际行为毫无贡献，只负责销毁状态。
    normalized.experiments.crossSiteCurrentTabSwap =
      normalized.experiments.crossSiteCurrentTabSwap === true;
    normalized.diagnostics = {
      enabled: normalized.diagnostics?.enabled === true,
    };
    normalized.layout = normalizeLayoutSettings(
      isPlainObject(migratedValue?.layout) ? migratedValue.layout : normalized.layout
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
