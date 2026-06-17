(() => {
  function syncBaseControlsFromSettings({
    elements,
    settingsApi,
    schedulerForm,
    aiControls,
    settings,
  }) {
    elements.languageMode.value = settings.appearance?.languageMode || "auto";
    elements.trackGoogleSearchPages.checked = settings.tracking.trackGoogleSearchPages;
    elements.excludeGoogleInternalPages.checked = settings.tracking.excludeGoogleInternalPages;
    elements.excludeHttpPages.checked = settings.tracking.excludeHttpPages !== false;
    elements.excludeLocalPages.checked = settings.tracking.excludeLocalPages !== false;
    elements.excludePrivateNetworkPages.checked =
      settings.tracking.excludePrivateNetworkPages !== false;
    elements.preloadingEnabled.checked = settings.preloading.enabled;
    elements.interactionPreloadEnabled.checked =
      settings.preloading.interactionPreloadEnabled !== false;
    elements.realPreloadEnabled.checked =
      settingsApi.isRealPreloadEnabled?.(settings) === true;
    elements.ignoreWaterfallDynamicLinks.checked =
      settings.preloading.ignoreWaterfallDynamicLinks;
    elements.excludeIncognitoWindows.checked =
      settings.preloading.excludeIncognitoWindows !== false;
    const proxySkipSettings =
      settingsApi.normalizeProxySkipSettings?.(settings.preloading.proxySkip) ??
      settings.preloading.proxySkip ??
      {};
    elements.proxySkipEnabled.checked = proxySkipSettings.enabled === true;
    elements.proxySkipMode.value =
      settingsApi.normalizeProxySkipMode?.(proxySkipSettings.mode) || "blacklist";
    elements.proxySkipRules.value = Array.isArray(proxySkipSettings.rules)
      ? proxySkipSettings.rules.join("\n")
      : "";
    elements.transitionWindowScopeEnabled.checked =
      settings.preloading.transitionWindowScope.enabled;
    elements.transitionWindowScope.value = settings.preloading.transitionWindowScope.windowKey;
    schedulerForm.syncSchedulerFieldsFromSettings(settings);
    elements.aiPredictionEnabled.checked = settings.preloading.aiPrediction.enabled;
    elements.aiPredictionProvider.value = settings.preloading.aiPrediction.providerId;
    aiControls?.syncProviderFieldsFromSettings?.(settings);
    elements.crossSiteCurrentTabSwap.checked =
      settingsApi.isRealPreloadEnabled?.(settings) === true &&
      settings.experiments.crossSiteCurrentTabSwap === true;
    elements.watchdogEnabled.checked = settings.preloadWindow.watchdogEnabled;
    elements.watchdogIntervalSeconds.value = String(
      settings.preloadWindow.watchdogIntervalSeconds
    );
    elements.fullscreenPressurePolicy.value =
      settingsApi.normalizeFullscreenPressurePolicy?.(
        settings.preloadWindow.fullscreenPressurePolicy
      ) || "sleep";
    elements.forceMinimize.checked = settings.preloadWindow.forceMinimize;
    elements.idleWakeAggressive.checked = settings.experiments.idleWakeAggressive;
    elements.pointerProximityPrediction.checked =
      settings.experiments.pointerProximityPrediction;
    elements.authStateWarmup.checked = settings.experiments.authStateWarmup;
    elements.diagnosticsLoggingEnabled.checked = settings.diagnostics?.enabled === true;
  }

  function syncMutuallyExclusivePreloadModeControls({ elements, target }) {
    if (
      target === elements.realPreloadEnabled &&
      elements.realPreloadEnabled.checked !== true
    ) {
      elements.crossSiteCurrentTabSwap.checked = false;
      return;
    }

    if (
      target === elements.crossSiteCurrentTabSwap &&
      elements.crossSiteCurrentTabSwap.checked === true
    ) {
      elements.realPreloadEnabled.checked = true;
    }
  }

  globalThis.ZeroLatencySettingsBaseFormSync = {
    syncBaseControlsFromSettings,
    syncMutuallyExclusivePreloadModeControls,
  };
})();
