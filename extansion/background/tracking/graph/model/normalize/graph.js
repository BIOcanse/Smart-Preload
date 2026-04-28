function normalizeTrackingGraph(rawGraph) {
  const graph = isPlainObject(rawGraph) ? rawGraph : createEmptyGraph();
  const storedVersion = clampNonNegativeInt(graph.version, 0);
  const storedEdgeSnapshots = captureStoredEdgeSnapshots(graph.edges);
  const storedTransitionMessageBucketLayer = getStoredTransitionMessageBucketLayer(
    graph.transitionMessageBuckets
  );
  graph.version = 10;
  graph.nodes = isPlainObject(graph.nodes) ? graph.nodes : {};
  graph.edges = isPlainObject(graph.edges) ? graph.edges : {};
  graph.linkBehaviorStore = normalizeLinkBehaviorStore(graph.linkBehaviorStore);
  graph.pageKeywordStore = normalizePageKeywordStore(graph.pageKeywordStore);
  graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();
  graph.recentForegroundPages = normalizeRecentForegroundPages(graph.recentForegroundPages);
  const normalizedHistoryPagePool = normalizeHistoryPagePool(
    graph.historyPageTitles,
    graph.historyPageUrls,
    graph.historyPageTexts,
    graph.recentForegroundPages
  );
  graph.historyPageTitles = normalizedHistoryPagePool.titles;
  graph.historyPageUrls = normalizedHistoryPagePool.urls;
  graph.historyPageTexts = normalizedHistoryPagePool.texts;
  graph.transitionMessages = normalizeTransitionMessages(
    Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages
      : Array.isArray(graph.recentTransitions)
        ? graph.recentTransitions.slice().reverse()
        : []
  );
  graph.transitionSequence = Math.max(
    clampNonNegativeInt(graph.transitionSequence, 0),
    getMaxTransitionSequence(graph.transitionMessages)
  );
  graph.transitionMessagesByDay = {};
  graph.updatedAt = typeof graph.updatedAt === "string" ? graph.updatedAt : null;

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    normalizeEdgeRecord(graph, edgeId, edge);
  }

  reconcileStartupTransitionCoverage(
    graph,
    storedVersion,
    storedEdgeSnapshots,
    storedTransitionMessageBucketLayer
  );

  graph.transitionBuckets = createEmptyTransitionBuckets();
  graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
  graph.pageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();

  for (const edge of Object.values(graph.edges)) {
    registerEdgeInTransitionBuckets(graph, edge);
  }

  for (const transitionMessage of graph.transitionMessages) {
    registerTransitionMessageInDayGroups(graph, transitionMessage);
    registerTransitionMessageInBuckets(graph, transitionMessage);
    registerTransitionMessageInPageIndexes(graph, transitionMessage);
  }

  for (const pageKeywordEntry of Object.values(graph.pageKeywordStore)) {
    indexPageKeywordEntry(graph, pageKeywordEntry);
  }

  delete graph.recentTransitions;

  return graph;
}
