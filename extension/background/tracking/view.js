function buildDebugSnapshot(graph) {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges).sort(
    (left, right) => getEdgeTotalCount(right) - getEdgeTotalCount(left)
  );
  const historyPagePool = getHistoryPagePool(graph, 5);

  return {
    version: graph.version,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    transitionMessageCount: Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages.length
      : 0,
    updatedAt: graph.updatedAt,
    transitionSequence: graph.transitionSequence ?? 0,
    topNodes: nodes
      .sort((left, right) => right.visitCount - left.visitCount)
      .slice(0, 10),
    topEdges: edges.slice(0, 10),
    recentTransitions: getRecentTransitionPreview(graph),
    learning: {
      pageKeywordCount: Object.keys(graph.pageKeywordStore || {}).length,
      recentForegroundPageCount: Array.isArray(graph.recentForegroundPages)
        ? graph.recentForegroundPages.length
        : 0,
      historyPagePool,
    },
    bookmarkPreloadBuckets: graph.bookmarkPreloadBuckets || {},
  };
}

function buildTrackingGraphSummary(graph) {
  const normalizedGraph = isPlainObject(graph) ? graph : createEmptyGraph();

  return normalizeTrackingGraphSummary({
    version: normalizedGraph.version,
    nodeCount: Object.keys(normalizedGraph.nodes || {}).length,
    edgeCount: Object.keys(normalizedGraph.edges || {}).length,
    transitionMessageCount: Array.isArray(normalizedGraph.transitionMessages)
      ? normalizedGraph.transitionMessages.length
      : 0,
    updatedAt: normalizedGraph.updatedAt,
    transitionSequence: normalizedGraph.transitionSequence ?? 0,
    learning: {
      pageKeywordCount: Object.keys(normalizedGraph.pageKeywordStore || {}).length,
      recentForegroundPageCount: Array.isArray(normalizedGraph.recentForegroundPages)
        ? normalizedGraph.recentForegroundPages.length
        : 0,
      historyPagePoolSize: Array.isArray(normalizedGraph.historyPageUrls)
        ? normalizedGraph.historyPageUrls.length
        : 0,
    },
  });
}

function normalizeTrackingGraphSummary(rawSummary, fallbackGraph = null) {
  if (!isPlainObject(rawSummary)) {
    return fallbackGraph ? buildTrackingGraphSummary(fallbackGraph) : createEmptyTrackingGraphSummary();
  }

  const rawLearning = isPlainObject(rawSummary.learning) ? rawSummary.learning : {};

  return {
    version: clampNonNegativeInt(rawSummary.version, 0),
    nodeCount: clampNonNegativeInt(rawSummary.nodeCount, 0),
    edgeCount: clampNonNegativeInt(rawSummary.edgeCount, 0),
    transitionMessageCount: clampNonNegativeInt(rawSummary.transitionMessageCount, 0),
    updatedAt: typeof rawSummary.updatedAt === "string" ? rawSummary.updatedAt : null,
    transitionSequence: clampNonNegativeInt(rawSummary.transitionSequence, 0),
    learning: {
      pageKeywordCount: clampNonNegativeInt(rawLearning.pageKeywordCount, 0),
      recentForegroundPageCount: clampNonNegativeInt(
        rawLearning.recentForegroundPageCount,
        0
      ),
      historyPagePoolSize: clampNonNegativeInt(rawLearning.historyPagePoolSize, 0),
    },
  };
}

function createEmptyTrackingGraphSummary() {
  return {
    version: 0,
    nodeCount: 0,
    edgeCount: 0,
    transitionMessageCount: 0,
    updatedAt: null,
    transitionSequence: 0,
    learning: {
      pageKeywordCount: 0,
      recentForegroundPageCount: 0,
      historyPagePoolSize: 0,
    },
  };
}


function buildCurrentTopDestinations(graph, nodeId, pageUrl) {
  if (!nodeId) {
    return [];
  }

  const pageEntries = getOutgoingPageEntriesForSource(graph, nodeId, pageUrl);
  const outgoingEntries =
    pageEntries.length > 0
      ? pageEntries
      : getOutgoingEdgeEntriesForNode(graph, nodeId).map(
          ({ edge, destinationNodeId, count }) => ({
            destinationNodeId,
            destinationPageUrl: edge?.toHost ?? destinationNodeId,
            count,
            lastSeenAt: edge?.lastSeenAt ?? null,
            lastTransitionType: edge?.lastTransitionType ?? "unknown",
            destinationLabel: deriveNodeLabel(destinationNodeId),
            destinationHost: edge?.toHost ?? destinationNodeId,
          })
        );

  return outgoingEntries
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
    .map((entry) => ({
      destinationNodeId: entry.destinationNodeId,
      destinationPageUrl: entry.destinationPageUrl ?? null,
      destinationLabel: entry.destinationLabel,
      destinationHost: entry.destinationHost,
      count: entry.count,
      lastSeenAt: entry.lastSeenAt ?? null,
      lastTransitionType: entry.lastTransitionType ?? "unknown",
    }));
}
