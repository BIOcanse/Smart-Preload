function rebuildDerivedTrackingHistoryIndexes(
  graph,
  { previousTransitionSequence, updatedAt } = {}
) {
  graph.edges = {};
  graph.transitionBuckets = createEmptyTransitionBuckets();
  graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
  graph.pageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.externalPageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.intraSitePageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();
  graph.transitionMessagesByDay = {};
  graph.transitionMessages = normalizeTransitionMessages(graph.transitionMessages || []);
  graph.transitionSequence = Math.max(
    clampNonNegativeInt(previousTransitionSequence, 0),
    getMaxTransitionSequence(graph.transitionMessages)
  );

  for (const transitionMessage of graph.transitionMessages) {
    applyTransitionMessageToIndexes(graph, transitionMessage);
  }

  graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();

  for (const pageKeywordEntry of Object.values(graph.pageKeywordStore || {})) {
    indexPageKeywordEntry(graph, pageKeywordEntry);
  }

  rebuildHistoryPagePoolFromRecentForegroundPages(graph);
  graph.updatedAt = typeof updatedAt === "string" ? updatedAt : new Date().toISOString();
}

function rebuildHistoryPagePoolFromRecentForegroundPages(graph) {
  const normalizedHistoryPagePool = normalizeHistoryPagePool(
    [],
    [],
    [],
    graph.recentForegroundPages
  );
  graph.historyPageTitles = normalizedHistoryPagePool.titles;
  graph.historyPageUrls = normalizedHistoryPagePool.urls;
  graph.historyPageTexts = normalizedHistoryPagePool.texts;
}

function buildHistoryDeletionCounts(graph) {
  return {
    transitionMessageCount: Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages.length
      : 0,
    edgeCount: Object.keys(graph.edges || {}).length,
    recentForegroundPageCount: Array.isArray(graph.recentForegroundPages)
      ? graph.recentForegroundPages.length
      : 0,
    historyPagePoolSize: Array.isArray(graph.historyPageUrls)
      ? graph.historyPageUrls.length
      : 0,
    pageKeywordCount: Object.keys(graph.pageKeywordStore || {}).length,
    linkBehaviorRecordCount: countLinkBehaviorRecords(graph.linkBehaviorStore),
    transitionSequence: clampNonNegativeInt(graph.transitionSequence, 0),
  };
}

function countLinkBehaviorRecords(linkBehaviorStore) {
  return Object.values(linkBehaviorStore || {}).reduce(
    (count, targetMap) =>
      count + (isPlainObject(targetMap) ? Object.keys(targetMap).length : 0),
    0
  );
}
