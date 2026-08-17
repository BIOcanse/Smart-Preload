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

// 按 UTC 范围删除历史之后，让 graph.nodes 也只保留幸存数据能支撑的内容。
//
// 此前 rebuildDerivedTrackingHistoryIndexes 重建了 edges 和全部桶、stores.js 过滤了三个
// store，但 **graph.nodes 完全没被触及**。后果是：一个只在被删窗口内访问过的站点，会留下
// 一条节点，里面带着 sampleUrl（**完整页面 URL**，不是 origin）和 firstSeenAt /
// lastSeenAt 时间戳——等于"你要求忘掉的那个页面还在，连什么时候访问的都在"。
// 这与设置页宣传的"删除指定时间范围内的本地历史记录"直接冲突。
//
// 处理原则按「内容 vs 量级」划界：
//   - 内容（页面 URL、时间戳）必须重算自幸存数据，算不出来的节点整条删除；
//   - visitCount 是量级不是内容，**保留不动**——它只用于 buildTrackingGraphSummary 的
//     topNodes 展示排序，不参与预加载排名；改它会改变用户在弹窗里看到的数字含义，
//     属于产品决策。已知代价：残存的计数里仍包含被删窗口内的访问次数。
function pruneTrackingNodesAfterHistoryDeletion(graph) {
  const survivingObservations = collectSurvivingNodeObservations(graph);
  const nodes = isPlainObject(graph.nodes) ? graph.nodes : {};
  const nextNodes = {};
  let removedNodeCount = 0;

  for (const [nodeId, node] of Object.entries(nodes)) {
    const observation = survivingObservations.get(nodeId);

    if (!observation) {
      // 幸存数据里再也没有任何东西引用它 —— 整条删除。
      removedNodeCount += 1;
      continue;
    }

    nextNodes[nodeId] = {
      ...node,
      sampleUrl: observation.pageUrl || node.sampleUrl,
      defaultLandingPageUrl:
        normalizePageUrlForIndex(observation.pageUrl || "") ||
        observation.pageUrl ||
        node.defaultLandingPageUrl,
      firstSeenAt: observation.firstSeenAt || node.firstSeenAt,
      lastSeenAt: observation.lastSeenAt || node.lastSeenAt,
    };
  }

  graph.nodes = nextNodes;
  return removedNodeCount;
}

// 幸存的引用来源有两处：transitionMessages（两端各带 nodeId 与 pageUrl）和
// recentForegroundPages（带 nodeId 与 pageUrl）。两者都已被范围删除过滤过。
function collectSurvivingNodeObservations(graph) {
  const observations = new Map();

  const observe = (nodeId, pageUrl, occurredAt) => {
    if (typeof nodeId !== "string" || !nodeId) {
      return;
    }

    const existing = observations.get(nodeId);

    if (!existing) {
      observations.set(nodeId, {
        pageUrl: typeof pageUrl === "string" ? pageUrl : "",
        firstSeenAt: typeof occurredAt === "string" ? occurredAt : "",
        lastSeenAt: typeof occurredAt === "string" ? occurredAt : "",
      });
      return;
    }

    if (!existing.pageUrl && typeof pageUrl === "string") {
      existing.pageUrl = pageUrl;
    }

    if (typeof occurredAt === "string" && occurredAt) {
      if (!existing.firstSeenAt || occurredAt < existing.firstSeenAt) {
        existing.firstSeenAt = occurredAt;
      }

      if (!existing.lastSeenAt || occurredAt > existing.lastSeenAt) {
        existing.lastSeenAt = occurredAt;
      }
    }
  };

  for (const message of Array.isArray(graph.transitionMessages) ? graph.transitionMessages : []) {
    observe(message?.fromNodeId, message?.fromPageUrl, message?.occurredAt);
    observe(message?.toNodeId, message?.toPageUrl, message?.occurredAt);
  }

  for (const page of Array.isArray(graph.recentForegroundPages) ? graph.recentForegroundPages : []) {
    observe(page?.nodeId, page?.pageUrl, page?.activatedAt || page?.occurredAt);
  }

  return observations;
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
