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
      automaticDeviceTuning: draftSettings.automaticDeviceTuning,
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
        mode: draftSettings.preloading.mode,
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
        crossSiteCurrentTabSwap:
          elements.realPreloadEnabled.checked === true &&
          elements.crossSiteCurrentTabSwap.checked === true,
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
