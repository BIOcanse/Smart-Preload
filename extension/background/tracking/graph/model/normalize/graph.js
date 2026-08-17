function normalizeTrackingGraph(rawGraph) {
  const graph = isPlainObject(rawGraph) ? rawGraph : createEmptyGraph();
  const storedVersion = clampNonNegativeInt(graph.version, 0);

  // 最快路径：这份数据就是**本版本、本 schema** 亲手整理并落盘的，整体跳过再校验。
  //
  // 下面两条路都是 O(图规模)，实测 2 万节点分别约 393 ms / 470 ms —— 而快路径只比慢路径
  // 便宜 15-20%，因为它剩下的工作（逐条 normalizeEdgeRecord、normalizeLinkBehaviorStore、
  // normalizePageKeywordStore…）全是对扩展自己刚写出去的数据做防御性再校验。
  // 学习图按 invariants 第 7 条无上限增长，这个数字只会往上走，而它在**每次 service
  // worker 冷启动**上、跑在唯一的线程里。
  //
  // 仍然保留 hasUsableTrackingSnapshotIndexes 这道**形状检查**：戳只能证明「谁写的」，
  // 证明不了「写完之后没被截断/损坏」。形状不对就退回完整归一化，损坏的存储照样能自愈。
  if (
    graph.normalizedBy === buildTrackingGraphNormalizationStamp() &&
    hasUsableTrackingSnapshotIndexes(graph)
  ) {
    return graph;
  }

  if (storedVersion >= TRACKING_GRAPH_SCHEMA_VERSION && hasUsableTrackingSnapshotIndexes(graph)) {
    return normalizeTrackingGraphSnapshot(graph);
  }

  // 走到这里说明戳不匹配（或形状不对）。清掉旧戳，让它只表示「**本版本**的 checkpoint
  // 归一化之后写出去的」——下一次 checkpoint 会重新盖。留着陈旧的戳没有害处但会误导读者。
  delete graph.normalizedBy;

  const storedEdgeSnapshots = captureStoredEdgeSnapshots(graph.edges);
  const storedTransitionMessageBucketLayer = getStoredTransitionMessageBucketLayer(
    graph.transitionMessageBuckets
  );
  const storedPageTransitionBuckets = isPlainObject(graph.pageTransitionBuckets)
    ? graph.pageTransitionBuckets
    : null;
  graph.version = TRACKING_GRAPH_SCHEMA_VERSION;
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

function hasUsableTrackingSnapshotIndexes(graph) {
  return (
    graph.persistenceMode === "incremental-checkpoint-v1" &&
    isPlainObject(graph.nodes) &&
    isPlainObject(graph.edges) &&
    Array.isArray(graph.transitionBuckets?.total) &&
    isPlainObject(graph.transitionBuckets?.byDay) &&
    Array.isArray(graph.externalPageTransitionBuckets?.total) &&
    isPlainObject(graph.externalPageTransitionBuckets?.byDay) &&
    Array.isArray(graph.intraSitePageTransitionBuckets?.total) &&
    isPlainObject(graph.intraSitePageTransitionBuckets?.byDay) &&
    Array.isArray(graph.transitionMessageBuckets?.buckets) &&
    Array.isArray(graph.pageTransitionMessageBuckets?.buckets)
  );
}

function normalizeTrackingGraphSnapshot(graph) {
  graph.version = TRACKING_GRAPH_SCHEMA_VERSION;
  graph.persistenceMode = "incremental-checkpoint-v1";
  // 同上：这条路也是「真干了活」，旧戳作废，交给下一次 checkpoint 重新盖。
  delete graph.normalizedBy;
  graph.nodes = isPlainObject(graph.nodes) ? graph.nodes : {};
  graph.edges = isPlainObject(graph.edges) ? graph.edges : {};

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    normalizeEdgeRecord(graph, edgeId, edge);
  }

  graph.linkBehaviorStore = normalizeLinkBehaviorStore(graph.linkBehaviorStore);
  graph.pageKeywordStore = normalizePageKeywordStore(graph.pageKeywordStore);
  graph.recentForegroundPages = normalizeRecentForegroundPages(graph.recentForegroundPages);
  const historyPagePool = normalizeHistoryPagePool(
    graph.historyPageTitles,
    graph.historyPageUrls,
    graph.historyPageTexts,
    graph.recentForegroundPages
  );
  graph.historyPageTitles = historyPagePool.titles;
  graph.historyPageUrls = historyPagePool.urls;
  graph.historyPageTexts = historyPagePool.texts;
  graph.transitionMessages = normalizeTransitionMessages(
    Array.isArray(graph.transitionMessages) ? graph.transitionMessages : []
  ).slice(-MAX_HOT_TRANSITION_MESSAGES);
  graph.transitionSequence = Math.max(
    clampNonNegativeInt(graph.transitionSequence, 0),
    getMaxTransitionSequence(graph.transitionMessages)
  );
  graph.transitionMessagesByDay = isPlainObject(graph.transitionMessagesByDay)
    ? graph.transitionMessagesByDay
    : {};
  graph.pageKeywordBuckets = isPlainObject(graph.pageKeywordBuckets)
    ? graph.pageKeywordBuckets
    : createEmptyPageKeywordBuckets();

  if (!isPlainObject(graph.pageKeywordBuckets.byKeyword)) {
    graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();

    for (const pageKeywordEntry of Object.values(graph.pageKeywordStore)) {
      indexPageKeywordEntry(graph, pageKeywordEntry);
    }
  }

  graph.bookmarkPreloadBuckets = normalizeBookmarkPreloadBuckets(
    graph.bookmarkPreloadBuckets
  );
  graph.updatedAt = typeof graph.updatedAt === "string" ? graph.updatedAt : null;
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
