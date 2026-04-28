function determineCrossSiteCurrentTabPreloadStrategy(_candidate, settings) {
  return isCrossSiteCurrentTabSwapStrategyEnabled(settings) ? "hidden-tab" : "prefetch";
}

