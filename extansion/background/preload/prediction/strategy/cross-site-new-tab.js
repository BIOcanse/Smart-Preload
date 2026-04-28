function determineCrossSiteNewTabPreloadStrategy(candidate) {
  if ((candidate?.outboundPageTransitionCount || 0) <= 0) {
    return "prefetch";
  }

  return supportsHiddenTabPreloadStrategy() ? "hidden-tab" : "prefetch";
}
