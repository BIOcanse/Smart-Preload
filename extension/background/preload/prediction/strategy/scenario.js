const PRELOAD_STRATEGY_SCENARIOS = {
  SAME_ORIGIN: "same-origin",
  CROSS_SITE_CURRENT_TAB: "cross-site-current-tab",
  CROSS_SITE_NEW_TAB: "cross-site-new-tab",
};

function determinePreloadStrategyScenario(candidate) {
  if (candidate?.isSameOrigin) {
    return PRELOAD_STRATEGY_SCENARIOS.SAME_ORIGIN;
  }

  return candidate?.targetHint === "_blank"
    ? PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_NEW_TAB
    : PRELOAD_STRATEGY_SCENARIOS.CROSS_SITE_CURRENT_TAB;
}

