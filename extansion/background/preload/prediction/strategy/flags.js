function supportsHiddenTabPreloadStrategy() {
  return globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() === true;
}

function isCrossSiteCurrentTabSwapStrategyEnabled(settings) {
  return (
    settings?.experiments?.crossSiteCurrentTabSwap === true &&
    supportsHiddenTabPreloadStrategy()
  );
}

