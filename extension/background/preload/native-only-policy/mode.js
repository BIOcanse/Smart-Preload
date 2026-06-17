function isAllNativePreloadModeEnabled(settings = resolveCurrentNativeOnlySettings()) {
  return (
    globalThis.ZeroLatencySettings?.isAllNativePreloadModeEnabled?.(settings) === true ||
    settings?.preloading?.realPreloadEnabled !== true
  );
}

function isRealPreloadEnabled(settings = resolveCurrentNativeOnlySettings()) {
  return (
    globalThis.ZeroLatencySettings?.isRealPreloadEnabled?.(settings) === true ||
    settings?.preloading?.realPreloadEnabled === true
  );
}

function resolveHiddenTabStrategyForNativeOnlyMode(strategy, settings) {
  if (strategy === "hidden-tab" && isAllNativePreloadModeEnabled(settings)) {
    return "prefetch";
  }

  return strategy;
}

function resolveCurrentNativeOnlySettings() {
  return typeof getEffectiveExtensionSettings === "function"
    ? getEffectiveExtensionSettings()
    : null;
}
