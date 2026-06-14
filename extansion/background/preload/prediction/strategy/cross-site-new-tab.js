function determineCrossSiteNewTabPreloadStrategy(candidate, settings) {
  if ((candidate?.outboundPageTransitionCount || 0) <= 0) {
    return "prefetch";
  }

  return supportsHiddenTabPreloadStrategy(settings) ? "hidden-tab" : "prefetch";
}
