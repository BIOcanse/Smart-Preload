function hasExistingPreloadForInteractionTarget(preloadState, context) {
  const sourceRuntime = getSourceTabRuntimeForWindow(
    preloadState,
    context.sourceTab.windowId,
    String(context.sourceTab.id)
  )?.sourceTabRuntime;

  if (!sourceRuntime) {
    return false;
  }

  return hasSourceTabPreloadEntryInAnyChannel(sourceRuntime, context.targetUrl);
}

function buildInteractionPreloadTarget(context) {
  const isSameOrigin = isSameOriginUrl(context.sourcePageUrl, context.targetUrl);
  const targetNodeId = buildNodeSeed(context.targetUrl).nodeId;
  const transitionMetrics = {
    siteTransitionCount: 0,
    outboundPageTransitionCount: context.forceNewTab ? 1 : 0,
    intraSitePageTransitionCount: 0,
    pageTransitionCount: 0,
    isSameSite: buildNodeSeed(context.sourcePageUrl).nodeId === targetNodeId,
  };
  const candidate = {
    url: context.targetUrl,
    nodeId: targetNodeId,
    targetHint: context.targetHint,
    isSameOrigin,
    ...transitionMetrics,
  };
  const strategy = context.forceNewTab
    ? resolveForcedNewTabInteractionStrategy(context.settings)
    : typeof determinePreloadStrategy === "function"
      ? determinePreloadStrategy(candidate, context.settings)
      : isSameOrigin
        ? "prerender"
        : "prefetch";
  const now = new Date().toISOString();

  return {
    url: context.targetUrl,
    nodeId: targetNodeId,
    score: 0,
    scoreBreakdown: null,
    transitionMetrics,
    targetHint: context.targetHint,
    aiKeywordMatch: null,
    bookmarkPreload: null,
    realPreloadSafety: context.realPreloadSafety ?? null,
    interactionPreload: {
      trigger: context.trigger,
      targetHint: context.targetHint,
      startedAt: now,
      updatedAt: now,
    },
    siteSelection: null,
    strategy,
  };
}

function resolveForcedNewTabInteractionStrategy(settings) {
  return supportsHiddenTabPreloadStrategy(settings) ? "hidden-tab" : "prefetch";
}
