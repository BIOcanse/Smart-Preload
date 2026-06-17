(function () {
  const { localize } = globalThis.ZeroLatencySettingsSchema;

  function getNavigatorSnapshot() {
    const runtimeNavigator = globalThis.navigator || {};

    return {
      hardwareConcurrency: Number(runtimeNavigator.hardwareConcurrency) || 0,
      deviceMemory: Number(runtimeNavigator.deviceMemory) || 0,
      userAgent: runtimeNavigator.userAgent || "",
    };
  }

  function detectDeviceProfile(snapshot = getNavigatorSnapshot()) {
    const hardwareConcurrency = Number(snapshot.hardwareConcurrency) || 0;
    const deviceMemory = Number(snapshot.deviceMemory) || 0;
    let id = "balanced";
    let label = localize("deviceProfileBalanced", "Balanced");
    let preloadCap = 3;

    if (hardwareConcurrency >= 12 || deviceMemory >= 16) {
      id = "high-end";
      label = localize("deviceProfileHighEnd", "High-end");
      preloadCap = 5;
    } else if (hardwareConcurrency >= 8 || deviceMemory >= 8) {
      id = "strong";
      label = localize("deviceProfileStrong", "Strong");
      preloadCap = 4;
    } else if (hardwareConcurrency > 0 && hardwareConcurrency <= 4) {
      id = "constrained";
      label = localize("deviceProfileConstrained", "Constrained");
      preloadCap = 2;
    }

    return {
      id,
      label,
      preloadCap,
      hardwareConcurrency,
      deviceMemory,
    };
  }

  function createEffectiveSettingsApi({
    normalizeStoredSettings,
    isAiPredictionConfigured,
  }) {
    function resolveEffectiveSettings(userSettings, snapshot = getNavigatorSnapshot()) {
      const normalized = normalizeStoredSettings(userSettings);
      const deviceProfile = detectDeviceProfile(snapshot);
      const effectiveTransitionWindowKey = normalized.preloading.transitionWindowScope.enabled
        ? normalized.preloading.transitionWindowScope.windowKey
        : "total";

      return {
        ...normalized,
        detectedDeviceProfile: deviceProfile,
        preloading: {
          ...normalized.preloading,
          effectiveNativeMaxPreloadsPerSource: Math.max(
            1,
            normalized.preloading.nativeMaxPreloadsPerSource ??
              normalized.preloading.maxTabsPerSource
          ),
          effectiveTabMaxPreloadsPerSource: Math.max(1, normalized.preloading.maxTabsPerSource),
          effectiveMaxTabsPerSource: Math.max(1, normalized.preloading.maxTabsPerSource),
          effectiveSiteSelectionLimit: Math.max(
            1,
            normalized.preloading.siteSelectionLimit ??
              normalized.preloading.nativeMaxPreloadsPerSource ??
              normalized.preloading.maxTabsPerSource
          ),
          effectiveTabSiteSelectionLimit: Math.max(
            1,
            normalized.preloading.tabSiteSelectionLimit ??
              normalized.preloading.maxTabsPerSource ??
              normalized.preloading.siteSelectionLimit
          ),
          effectiveTransitionWindowKey,
          effectiveRealPreloadEnabled: normalized.preloading.realPreloadEnabled === true,
          effectiveAllNativePreloadMode: normalized.preloading.realPreloadEnabled !== true,
          effectivePreloadScheduler: normalized.preloading.scheduler,
          effectiveAiPredictionConfigured: isAiPredictionConfigured(
            normalized.preloading.aiPrediction
          ),
        },
      };
    }

    return {
      resolveEffectiveSettings,
    };
  }

  globalThis.ZeroLatencySettingsEffective = {
    create: createEffectiveSettingsApi,
    detectDeviceProfile,
    getNavigatorSnapshot,
  };
})();
