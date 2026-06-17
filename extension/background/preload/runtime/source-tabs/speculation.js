function synchronizePrerenderEntriesForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
  return synchronizeSpeculationEntriesForSourceTab(
    preloadState,
    normalWindowId,
    sourceTabId,
    targets,
    "prerender"
  );
}

function synchronizePrefetchEntriesForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
  return synchronizeSpeculationEntriesForSourceTab(
    preloadState,
    normalWindowId,
    sourceTabId,
    targets,
    "prefetch"
  );
}

function synchronizeSpeculationEntriesForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets,
  strategy
) {
  const channel = getSourceTabSpeculationChannelForStrategy(strategy);

  if (!channel) {
    return preloadState;
  }

  const existingRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    normalWindowId,
    sourceTabId
  );

  if (!existingRuntimeEntry && targets.length === 0) {
    return preloadState;
  }

  const sourceRuntimeEntry =
    existingRuntimeEntry ?? ensureSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  const nextEntries = copyInteractionPreloadEntries(
    getSourceTabPreloadChannelStore(sourceRuntimeEntry.sourceTabRuntime, channel)
  );

  for (const target of targets) {
    nextEntries[target.url] = buildSpeculationPreloadEntry(target, strategy);
  }

  setSourceTabPreloadChannelStore(sourceRuntimeEntry.sourceTabRuntime, channel, nextEntries);
  markSourceTabPreloadChannelsUpdated(preloadState, sourceRuntimeEntry);
  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  return preloadState;
}

function buildSpeculationPreloadEntry(target, strategy) {
  const entry = {
    requestedUrl: target.url,
    nodeId: target.nodeId,
    score: target.score,
    scoreBreakdown: target.scoreBreakdown ?? null,
    transitionMetrics: target.transitionMetrics ?? null,
    aiKeywordMatch: target.aiKeywordMatch ?? null,
    bookmarkPreload: target.bookmarkPreload ?? null,
    realPreloadSafety: target.realPreloadSafety ?? null,
    interactionPreload: target.interactionPreload ?? null,
    siteSelection: target.siteSelection ?? null,
    status: strategy,
    strategy,
    updatedAt: new Date().toISOString(),
  };

  if (strategy === "prerender") {
    entry.targetHint = target.targetHint;
  }

  return entry;
}
