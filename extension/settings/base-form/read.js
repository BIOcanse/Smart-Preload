(() => {
  function readBaseFormSettings({
    elements,
    settingsApi,
    schedulerForm,
    draftSettings,
    aiControls,
  }) {
    const aiPredictionSettings =
      aiControls?.readFormAiPrediction?.(draftSettings) ??
      draftSettings.preloading?.aiPrediction ??
      settingsApi.DEFAULT_SETTINGS.preloading.aiPrediction;

    return settingsApi.normalizeStoredSettings({
      appearance: {
        languageMode: elements.languageMode.value,
      },
      tracking: {
        trackGoogleSearchPages: elements.trackGoogleSearchPages.checked,
        excludeGoogleInternalPages: elements.excludeGoogleInternalPages.checked,
        excludeHttpPages: elements.excludeHttpPages.checked,
        excludeLocalPages: elements.excludeLocalPages.checked,
        excludePrivateNetworkPages: elements.excludePrivateNetworkPages.checked,
      },
      preloading: {
        enabled: elements.preloadingEnabled.checked,
        nativeMaxPreloadsPerSource: draftSettings.preloading.nativeMaxPreloadsPerSource,
        maxTabsPerSource: draftSettings.preloading.maxTabsPerSource,
        siteSelectionLimit: draftSettings.preloading.siteSelectionLimit,
        tabSiteSelectionLimit: draftSettings.preloading.tabSiteSelectionLimit,
        interactionPreloadEnabled: elements.interactionPreloadEnabled.checked,
        realPreloadEnabled: elements.realPreloadEnabled.checked,
        realPreloadRiskAcknowledged:
          draftSettings.preloading.realPreloadRiskAcknowledged === true,
        skipSensitivePages: elements.skipSensitivePages.checked,
        ignoreWaterfallDynamicLinks: elements.ignoreWaterfallDynamicLinks.checked,
        excludeIncognitoWindows: elements.excludeIncognitoWindows.checked,
        proxySkip: {
          enabled: elements.proxySkipEnabled.checked,
          mode: elements.proxySkipMode.value,
          rules: settingsApi.normalizeProxySkipRules?.(elements.proxySkipRules.value) ?? [],
        },
        transitionWindowScope: {
          enabled: elements.transitionWindowScopeEnabled.checked,
          windowKey: elements.transitionWindowScope.value,
        },
        scheduler: schedulerForm.readSchedulerSettingsFromForm(),
        aiPrediction: aiPredictionSettings,
      },
      preloadWindow: {
        watchdogEnabled: elements.watchdogEnabled.checked,
        watchdogIntervalSeconds: Number(elements.watchdogIntervalSeconds.value) || 30,
        fullscreenPressurePolicy: elements.fullscreenPressurePolicy.value,
        forceMinimize: elements.forceMinimize.checked,
      },
      experiments: {
        // 不与 realPreloadEnabled 联动：保存用户实际选的值。关掉 Real Preload 时该复选框
        // 由 computed.js 置为 disabled，但 disabled 的复选框仍然保留并回报 checked，
        // 所以用户的选择能原样存回去。实际是否生效由 strategy/flags.js 在使用点决定。
        crossSiteCurrentTabSwap: elements.crossSiteCurrentTabSwap.checked === true,
        idleWakeAggressive: elements.idleWakeAggressive.checked,
        pointerProximityPrediction: elements.pointerProximityPrediction.checked,
        authStateWarmup: elements.authStateWarmup.checked,
      },
      diagnostics: {
        enabled: elements.diagnosticsLoggingEnabled.checked,
      },
      layout: {
        ruleCards: {
          items: settingsApi.cloneSettings(draftSettings.layout.ruleCards.items),
        },
      },
    });
  }

  globalThis.ZeroLatencySettingsBaseFormRead = {
    readBaseFormSettings,
  };
})();
