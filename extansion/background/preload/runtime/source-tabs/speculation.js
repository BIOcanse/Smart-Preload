function synchronizePrerenderEntriesForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
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
  const nextEntries = {};

  for (const target of targets) {
    nextEntries[target.url] = {
      requestedUrl: target.url,
      nodeId: target.nodeId,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      siteSelection: target.siteSelection ?? null,
      status: "prerender",
      strategy: "prerender",
      targetHint: target.targetHint,
      updatedAt: new Date().toISOString(),
    };
  }

  sourceRuntimeEntry.sourceTabRuntime.prerenderEntriesByUrl = nextEntries;
  sourceRuntimeEntry.sourceTabRuntime.updatedAt = new Date().toISOString();
  sourceRuntimeEntry.normalWindowRuntime.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  preloadState.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  return preloadState;
}

function synchronizePrefetchEntriesForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
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
  const nextEntries = {};

  for (const target of targets) {
    nextEntries[target.url] = {
      requestedUrl: target.url,
      nodeId: target.nodeId,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      siteSelection: target.siteSelection ?? null,
      status: "prefetch",
      strategy: "prefetch",
      updatedAt: new Date().toISOString(),
    };
  }

  sourceRuntimeEntry.sourceTabRuntime.prefetchEntriesByUrl = nextEntries;
  sourceRuntimeEntry.sourceTabRuntime.updatedAt = new Date().toISOString();
  sourceRuntimeEntry.normalWindowRuntime.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  preloadState.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  return preloadState;
}
