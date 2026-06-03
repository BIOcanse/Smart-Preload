(function () {
  function buildPageContext(trackingState, preloadState, tabId, pageUrl) {
    const trackable = isTrackableAndAllowedUrl(pageUrl || "");
    const normalizedPageUrl = normalizePageUrlForIndex(pageUrl || "");
    const trackedTabState = trackingState.tabState[String(tabId)] ?? null;
    const trackedTabPageUrl = normalizePageUrlForIndex(trackedTabState?.url || "");
    const derivedNodeId = trackable ? buildNodeSeed(pageUrl).nodeId : null;
    const nodeId =
      normalizedPageUrl && trackedTabPageUrl && normalizedPageUrl === trackedTabPageUrl
        ? trackedTabState?.nodeId ?? derivedNodeId ?? null
        : derivedNodeId ?? trackedTabState?.nodeId ?? null;
    const sourceTabRuntimeEntry = findSourceTabRuntime(preloadState, tabId);

    return {
      tabId: normalizePositiveInteger(tabId),
      pageUrl: normalizedPageUrl || pageUrl || null,
      nodeId,
      pageLabel: normalizedPageUrl ? derivePageLabel(normalizedPageUrl) : "Untracked page",
      trackable,
      preloadWindowId: normalizePositiveInteger(
        sourceTabRuntimeEntry?.normalWindowRuntime?.preloadWindow?.windowId
      ),
      preloadWindowHwnd: normalizePositiveFiniteNumber(
        sourceTabRuntimeEntry?.normalWindowRuntime?.preloadWindow?.hwnd
      ),
      preloadWindowHiddenBySystem:
        sourceTabRuntimeEntry?.normalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
      hasPreloadWindow: normalizePositiveInteger(
        sourceTabRuntimeEntry?.normalWindowRuntime?.preloadWindow?.windowId
      ) !== null,
    };
  }

  function buildCurrentPreloads(preloadState, tabId) {
    const sourceTabRuntimeEntry = findSourceTabRuntime(preloadState, tabId);
    const sourceTabRuntime = sourceTabRuntimeEntry?.sourceTabRuntime;
    const hiddenTabEntries = Object.values(sourceTabRuntime?.hiddenTabEntriesByUrl || {}).map(
      (entry) => ({
        requestedUrl: entry.requestedUrl,
        loadedUrl: entry.loadedUrl,
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown ?? null,
        transitionMetrics: entry.transitionMetrics ?? null,
        aiKeywordMatch: entry.aiKeywordMatch ?? null,
        bookmarkPreload: entry.bookmarkPreload ?? null,
        interactionPreload: entry.interactionPreload ?? null,
        siteSelection: entry.siteSelection ?? null,
        status: entry.status,
        strategy: "hidden-tab",
        nodeLabel: deriveNodeLabel(entry.nodeId),
      })
    );
    const prerenderEntries = Object.values(sourceTabRuntime?.prerenderEntriesByUrl || {}).map(
      (entry) => ({
        requestedUrl: entry.requestedUrl,
        loadedUrl: entry.requestedUrl,
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown ?? null,
        transitionMetrics: entry.transitionMetrics ?? null,
        aiKeywordMatch: entry.aiKeywordMatch ?? null,
        bookmarkPreload: entry.bookmarkPreload ?? null,
        interactionPreload: entry.interactionPreload ?? null,
        siteSelection: entry.siteSelection ?? null,
        status: entry.status,
        strategy: "prerender",
        nodeLabel: derivePageLabel(entry.requestedUrl),
      })
    );
    const prefetchEntries = Object.values(sourceTabRuntime?.prefetchEntriesByUrl || {}).map(
      (entry) => ({
        requestedUrl: entry.requestedUrl,
        loadedUrl: entry.requestedUrl,
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown ?? null,
        transitionMetrics: entry.transitionMetrics ?? null,
        aiKeywordMatch: entry.aiKeywordMatch ?? null,
        bookmarkPreload: entry.bookmarkPreload ?? null,
        interactionPreload: entry.interactionPreload ?? null,
        siteSelection: entry.siteSelection ?? null,
        status: entry.status,
        strategy: "prefetch",
        nodeLabel: derivePageLabel(entry.requestedUrl),
      })
    );

    return [...prerenderEntries, ...prefetchEntries, ...hiddenTabEntries]
      .sort(compareCurrentPreloadViewPriority)
      .slice(0, 3)
      .map((entry) => ({
        requestedUrl: entry.requestedUrl,
        loadedUrl: entry.loadedUrl,
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown ?? null,
        transitionMetrics: entry.transitionMetrics ?? null,
        aiKeywordMatch: entry.aiKeywordMatch ?? null,
        bookmarkPreload: entry.bookmarkPreload ?? null,
        interactionPreload: entry.interactionPreload ?? null,
        siteSelection: entry.siteSelection ?? null,
        status: entry.status,
        strategy: entry.strategy,
        nodeLabel: entry.nodeLabel,
      }));
  }

  function compareCurrentPreloadViewPriority(left, right) {
    if (left?.bookmarkPreload && right?.bookmarkPreload) {
      const rankDelta =
        (Number(left.bookmarkPreload.rank) || 0) - (Number(right.bookmarkPreload.rank) || 0);

      if (rankDelta !== 0) {
        return rankDelta;
      }
    }

    return (Number(right?.score) || 0) - (Number(left?.score) || 0);
  }

  globalThis.buildPageContext = buildPageContext;
  globalThis.buildCurrentPreloads = buildCurrentPreloads;
})();
