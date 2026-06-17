(() => {
  function getElement(id) {
    return document.getElementById(id);
  }

  function collectSettingsPageElements() {
    const form = {
      languageMode: getElement("language-mode"),
      trackGoogleSearchPages: getElement("track-google-search-pages"),
      excludeGoogleInternalPages: getElement("exclude-google-internal-pages"),
      excludeHttpPages: getElement("exclude-http-pages"),
      excludeLocalPages: getElement("exclude-local-pages"),
      excludePrivateNetworkPages: getElement("exclude-private-network-pages"),
      preloadingEnabled: getElement("preloading-enabled"),
      interactionPreloadEnabled: getElement("interaction-preload-enabled"),
      realPreloadEnabled: getElement("real-preload-enabled"),
      skipSensitivePages: getElement("skip-sensitive-pages"),
      ignoreWaterfallDynamicLinks: getElement("ignore-waterfall-dynamic-links"),
      excludeIncognitoWindows: getElement("exclude-incognito-windows"),
      proxySkipEnabled: getElement("proxy-skip-enabled"),
      proxySkipMode: getElement("proxy-skip-mode"),
      proxySkipRules: getElement("proxy-skip-rules"),
      transitionWindowScope: getElement("transition-window-scope"),
      transitionWindowScopeEnabled: getElement("transition-window-scope-enabled"),
      schedulerTabTotalMin: getElement("scheduler-tab-total-min"),
      schedulerTabTotalMax: getElement("scheduler-tab-total-max"),
      schedulerTabHalfLifeTabs: getElement("scheduler-tab-half-life-tabs"),
      schedulerNativeTotalMin: getElement("scheduler-native-total-min"),
      schedulerNativeTotalMax: getElement("scheduler-native-total-max"),
      schedulerNativeHalfLifeTabs: getElement("scheduler-native-half-life-tabs"),
      schedulerAttentionPoolHours: getElement("scheduler-attention-pool-hours"),
      schedulerAttentionSegmentSeconds: getElement("scheduler-attention-segment-seconds"),
      schedulerAttentionMaxGapSeconds: getElement("scheduler-attention-max-gap-seconds"),
      schedulerAttentionInputWindowSeconds: getElement(
        "scheduler-attention-input-window-seconds"
      ),
      schedulerAttentionMediaWeight: getElement("scheduler-attention-media-weight"),
      schedulerAttentionAudioWeight: getElement("scheduler-attention-audio-weight"),
      aiPredictionProvider: getElement("ai-prediction-provider"),
      aiModelListMode: getElement("ai-model-list-mode"),
      aiPredictionModel: getElement("ai-prediction-model"),
      aiProviderApiKey: getElement("ai-provider-api-key"),
      aiProviderEndpoint: getElement("ai-provider-endpoint"),
      aiPredictionEnabled: getElement("ai-prediction-enabled"),
      crossSiteCurrentTabSwap: getElement("cross-site-current-tab-swap"),
      watchdogEnabled: getElement("watchdog-enabled"),
      watchdogIntervalSeconds: getElement("watchdog-interval-seconds"),
      fullscreenPressurePolicy: getElement("fullscreen-pressure-policy"),
      forceMinimize: getElement("force-minimize"),
      idleWakeAggressive: getElement("idle-wake-aggressive"),
      pointerProximityPrediction: getElement("pointer-proximity-prediction"),
      authStateWarmup: getElement("auth-state-warmup"),
      diagnosticsLoggingEnabled: getElement("diagnostics-logging-enabled"),
    };
    const saveButton = getElement("save-button");
    const resetButton = getElement("reset-button");

    return {
      form,
      saveButton,
      resetButton,
      aiPredictionMismatchWarning: getElement("ai-prediction-mismatch-warning"),
      statusBar: {
        saveButton,
        resetButton,
        footerStatusTitle: getElement("footer-status-title"),
        footerStatusText: getElement("footer-status-text"),
        navStatusText: getElement("nav-status-text"),
      },
      baseFormState: {
        watchdogIntervalRow: getElement("watchdog-interval-row"),
        transitionWindowScopeRow: getElement("transition-window-scope-row"),
        hiddenTabsSchedulerGroup: getElement("scheduler-hidden-tabs-group"),
        crossSiteCurrentTabSwapRow: getElement("cross-site-current-tab-swap-row"),
      },
      ruleCardContainers: {
        preload: getElement("preload-rule-cards-list"),
        tracking: getElement("tracking-rule-cards-list"),
      },
    };
  }

  globalThis.ZeroLatencySettingsElements = {
    collect: collectSettingsPageElements,
  };
})();
