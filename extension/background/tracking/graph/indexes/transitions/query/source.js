function getTransitionCount(graph, windowKey, sourceNodeId, targetNodeId) {
  return clampNonNegativeInt(getTransitionMapForSource(graph, windowKey, sourceNodeId)[targetNodeId], 0);
}

function getTransitionMapForSource(graph, windowKey, sourceNodeId) {
  if (!sourceNodeId) {
    return {};
  }

  if (windowKey === "total") {
    return (
      graph.transitionBuckets?.total?.[getSourceBucketIndex(graph, sourceNodeId)]?.[sourceNodeId] ?? {}
    );
  }

  const aggregatedSourceMap = {};

  for (const dayKey of getTransitionWindowMatchingDayKeys(graph, windowKey)) {
    const sourceMap =
      graph.transitionBuckets?.byDay?.[dayKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
        sourceNodeId
      ] ?? {};

    for (const [targetNodeId, count] of Object.entries(sourceMap)) {
      aggregatedSourceMap[targetNodeId] =
        clampNonNegativeInt(aggregatedSourceMap[targetNodeId], 0) + clampNonNegativeInt(count, 0);
    }
  }

  return aggregatedSourceMap;
}

function getOutgoingEdgeEntriesForNode(graph, sourceNodeId) {
  return Object.entries(getTransitionMapForSource(graph, "total", sourceNodeId)).map(
    ([destinationNodeId, count]) => ({
      edge: graph.edges[`${sourceNodeId} -> ${destinationNodeId}`] ?? null,
      destinationNodeId,
      count: clampNonNegativeInt(count, 0),
    })
  );
}
