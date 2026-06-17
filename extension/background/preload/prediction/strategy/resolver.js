function determinePreloadStrategy(candidate, settings) {
  const scenario = determinePreloadStrategyScenario(candidate);
  const resolver = PRELOAD_STRATEGY_RESOLVERS[scenario];

  if (typeof resolver === "function") {
    const strategy = resolver(candidate, settings);
    if (
      strategy === "hidden-tab" &&
      globalThis.ZeroLatencyPreloadSafetyPolicy?.shouldBlockRealPreload?.(candidate) === true
    ) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload.safety.block-real-strategy", {
        targetUrl: candidate?.url || "",
        reason:
          candidate?.realPreloadSafety?.reason ||
          globalThis.ZeroLatencyPreloadSafetyPolicy?.inspectPreloadCandidate?.(candidate)?.reason ||
          "unsafe-real-preload",
      });
      return "prefetch";
    }
    return globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.resolveHiddenTabStrategyForNativeOnlyMode?.(
      strategy,
      settings
    ) ?? strategy;
  }

  return "prefetch";
}

const PRELOAD_STRATEGY_RESOLVERS = {
  [PRELOAD_STRATEGY_SCENARIOS.SAME_ORIGIN]: determineSameOriginPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_CURRENT_TAB]:
    determineCrossSiteCurrentTabPreloadStrategy,
  [PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_NEW_TAB]: determineCrossSiteNewTabPreloadStrategy,
};
