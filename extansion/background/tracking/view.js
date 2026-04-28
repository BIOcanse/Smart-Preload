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
