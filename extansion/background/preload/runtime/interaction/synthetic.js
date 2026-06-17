function upsertSyntheticInteractionPreload(preloadState, context, target, startedAt) {
  const sourceRuntimeEntry = ensureSourceTabRuntime(
    preloadState,
    context.sourceTab.windowId,
    String(context.sourceTab.id)
  );
  const channel = getSourceTabSpeculationChannelForStrategy(target.strategy);

  if (!channel) {
    return preloadState;
  }

  setSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, channel, target.url, {
    requestedUrl: target.url,
    nodeId: target.nodeId,
    score: 0,
    scoreBreakdown: null,
    transitionMetrics: target.transitionMetrics,
    status: target.strategy,
    strategy: target.strategy,
    targetHint: target.targetHint,
    aiKeywordMatch: null,
    bookmarkPreload: null,
    realPreloadSafety: target.realPreloadSafety ?? null,
    interactionPreload: {
      ...target.interactionPreload,
      startedAt,
      updatedAt: startedAt,
    },
    siteSelection: null,
    updatedAt: startedAt,
  });
  markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, startedAt);
  return preloadState;
}
