(function () {
  const {
    SETTINGS_STORAGE_VERSION,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_OPTIONS,
  } = globalThis.ZeroLatencySettingsSchema;

  function createDefaultAiProviderMap(defaultValue) {
    return Object.fromEntries(AI_PROVIDER_VALUES.map((providerId) => [providerId, defaultValue]));
  }

  function createDefaultAiProviderModelIds() {
    return Object.fromEntries(
      AI_PROVIDER_OPTIONS.map((provider) => [provider.value, provider.defaultModelId])
    );
  }

  function createDefaultAiProviderEndpointUrls() {
    return Object.fromEntries(
      AI_PROVIDER_OPTIONS.map((provider) => [provider.value, provider.endpointUrl])
    );
  }

  const DEFAULT_SETTINGS = {
    version: SETTINGS_STORAGE_VERSION,
    automaticDeviceTuning: true,
    appearance: {
      languageMode: "auto",
    },
    tracking: {
      trackGoogleSearchPages: true,
      excludeGoogleInternalPages: true,
      excludeHttpPages: true,
      excludeLocalPages: true,
      excludePrivateNetworkPages: true,
    },
    preloading: {
      enabled: true,
      mode: "balanced",
      nativeMaxPreloadsPerSource: 4,
      maxTabsPerSource: 1,
      siteSelectionLimit: 3,
      tabSiteSelectionLimit: 2,
      realPreloadEnabled: false,
      interactionPreloadEnabled: true,
      skipSensitivePages: true,
      ignoreWaterfallDynamicLinks: true,
      excludeIncognitoWindows: true,
      proxySkip: {
        enabled: false,
        mode: "blacklist",
        rules: [],
      },
      transitionWindowScope: {
        enabled: false,
        windowKey: "total",
      },
      scheduler: {
        nativeTotalMin: 3,
        nativeTotalMax: 16,
        nativeHalfLifeTabs: 8,
        tabTotalMin: 1,
        tabTotalMax: 4,
        tabHalfLifeTabs: 8,
        attentionPoolHours: 5,
        attentionSegmentSeconds: 60,
        attentionMaxObservableGapSeconds: 60,
        attentionInputWindowSeconds: 60,
        attentionMediaPlaybackWeight: 0.2,
        attentionAudioPlaybackWeight: 0.07,
      },
      aiPrediction: {
        enabled: false,
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        modelListMode: "recommended",
        apiKeys: createDefaultAiProviderMap(""),
        modelIds: createDefaultAiProviderModelIds(),
        endpointUrls: createDefaultAiProviderEndpointUrls(),
      },
    },
    preloadWindow: {
      watchdogEnabled: true,
      watchdogIntervalSeconds: 1,
      fullscreenPressurePolicy: "sleep",
      forceMinimize: true,
      systemLevelHiding: {
        support: {
          windows: true,
          mac: false,
          linux: false,
        },
        usable: false,
      },
    },
    experiments: {
      crossSiteCurrentTabSwap: false,
      idleWakeAggressive: false,
      pointerProximityPrediction: false,
      authStateWarmup: false,
    },
    diagnostics: {
      enabled: true,
    },
    layout: {
      ruleCards: {
        items: {
          nativePerPagePreloadLimit: {
            valueA: 0,
            operatorA: "disabled",
            valueB: 1,
            operatorB: "lte",
            valueC: 4,
            status: "enabled",
          },
          perPagePreloadLimit: {
            valueA: 0,
            operatorA: "disabled",
            valueB: 1,
            operatorB: "lte",
            valueC: 1,
            status: "enabled",
          },
          highWeightRank: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "lte",
            valueC: 3,
            status: "enabled",
          },
          highWeightRankTab: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "lte",
            valueC: 2,
            status: "enabled",
          },
          googleBookmarkRank: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "lte",
            valueC: 5,
            status: "disabled",
          },
        },
      },
    },
  };

  globalThis.ZeroLatencySettingsDefaults = {
    DEFAULT_SETTINGS,
  };
})();
