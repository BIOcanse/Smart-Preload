function supportsHiddenTabPreloadStrategy(settings) {
  return (
    isAllNativePreloadModeEnabledForStrategy(settings) !== true &&
    globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() === true
  );
}

function isCrossSiteCurrentTabSwapStrategyEnabled(settings) {
  return (
    settings?.experiments?.crossSiteCurrentTabSwap === true &&
    supportsHiddenTabPreloadStrategy(settings)
  );
}

function isAllNativePreloadModeEnabledForStrategy(settings) {
  return (
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      settings
    ) === true ||
    globalThis.ZeroLatencySettings?.isAllNativePreloadModeEnabled?.(settings) === true ||
    settings?.preloading?.allNativePreloadMode === true
  );
}
