function normalizeTrackingGraph(rawGraph) {
  const graph = isPlainObject(rawGraph) ? rawGraph : createEmptyGraph();
  const storedVersion = clampNonNegativeInt(graph.version, 0);
  const storedEdgeSnapshots = captureStoredEdgeSnapshots(graph.edges);
  const storedTransitionMessageBucketLayer = getStoredTransitionMessageBucketLayer(
    graph.transitionMessageBuckets
  );
  const storedPageTransitionBuckets = isPlainObject(graph.pageTransitionBuckets)
    ? graph.pageTransitionBuckets
    : null;
  graph.version = 13;
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
  graph.externalPageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.intraSitePageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();
  graph.bookmarkPreloadBuckets = normalizeBookmarkPreloadBuckets(
    graph.bookmarkPreloadBuckets
  );

  if (graph.transitionMessages.length === 0) {
    for (const edge of Object.values(graph.edges)) {
      registerEdgeInTransitionBuckets(graph, edge);
    }
    migrateLegacyPageTransitionBuckets(graph, storedPageTransitionBuckets);
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

function migrateLegacyPageTransitionBuckets(graph, legacyBuckets) {
  if (!isPlainObject(legacyBuckets)) {
    return;
  }

  migrateLegacyPageTransitionBucketLayer(graph, legacyBuckets.total, null);

  for (const [dayKey, bucketLayer] of Object.entries(legacyBuckets.byDay || {})) {
    if (isValidDayKey(dayKey)) {
      migrateLegacyPageTransitionBucketLayer(graph, bucketLayer, dayKey);
    }
  }
}

function migrateLegacyPageTransitionBucketLayer(graph, bucketLayer, dayKey) {
  if (!Array.isArray(bucketLayer)) {
    return;
  }

  for (const bucket of bucketLayer) {
    if (!isPlainObject(bucket)) {
      continue;
    }

    for (const [sourceNodeId, sourcePages] of Object.entries(bucket)) {
      for (const [sourcePageUrl, targetSites] of Object.entries(sourcePages || {})) {
        for (const [targetNodeId, targetPages] of Object.entries(targetSites || {})) {
          for (const [targetPageUrl, count] of Object.entries(targetPages || {})) {
            const normalizedCount = clampNonNegativeInt(count, 0);

            if (normalizedCount <= 0) {
              continue;
            }

            const targetBuckets =
              sourceNodeId === targetNodeId
                ? "intraSitePageTransitionBuckets"
                : "externalPageTransitionBuckets";
            const targetLayer =
              dayKey === null
                ? graph[targetBuckets].total
                : targetBuckets === "intraSitePageTransitionBuckets"
                  ? getIntraSitePageTransitionBucketDayLayer(graph, dayKey)
                  : getExternalPageTransitionBucketDayLayer(graph, dayKey);

            incrementPageTransitionBucketCount(
              targetLayer,
              graph,
              sourceNodeId,
              sourcePageUrl,
              targetNodeId,
              targetPageUrl,
              normalizedCount
            );
          }
        }
      }
    }
  }
}
