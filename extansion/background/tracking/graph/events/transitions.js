function applyRecordVisitFallback(state, event) {
  const tabId = event.tabId;
  const pendingSource = consumePendingSourceForVisit(state, tabId, event.occurredAt);
  const targetNodeId = event.targetNode.nodeId;
  const previousNodeId = pendingSource?.nodeId ?? state.tabState[tabId]?.nodeId ?? null;
  const previousPageUrl =
    normalizePageUrlForIndex(pendingSource?.pageUrl || "") ??
    normalizePageUrlForIndex(state.tabState[tabId]?.url || "");
  const targetPageUrl = normalizePageUrlForIndex(event.url);
  const isNewNodeVisit = previousNodeId === null || previousNodeId !== targetNodeId;
  const isNewPageVisit = previousPageUrl !== targetPageUrl;
  const hasSourceContext = Boolean(previousNodeId || previousPageUrl);
  const isExactSelfTransition =
    previousNodeId === targetNodeId && previousPageUrl === targetPageUrl;
  const shouldRecordTransition =
    hasSourceContext && (isNewNodeVisit || isNewPageVisit) && !isExactSelfTransition;

  upsertNodeFallback(state.graph, event.targetNode, event.occurredAt);

  if (isNewNodeVisit) {
    state.graph.nodes[targetNodeId].visitCount += 1;
  }

  if (shouldRecordTransition) {
    state.graph.transitionSequence = (state.graph.transitionSequence ?? 0) + 1;
    const transitionMessage = createTransitionMessageRecord(
      state.graph,
      event,
      previousNodeId,
      previousPageUrl,
      targetNodeId
    );
    appendTransitionMessage(state.graph, transitionMessage);
    applyTransitionMessageToIndexes(state.graph, transitionMessage);
  }

  state.graph.updatedAt = event.occurredAt;
  state.tabState[tabId] = {
    nodeId: targetNodeId,
    url: event.url,
    updatedAt: event.occurredAt,
  };

  return state;
}

function consumePendingSourceForVisit(state, tabId, occurredAt) {
  const pendingSource = state.pendingSources?.[tabId] ?? null;
  const occurredAtTimestamp = Date.parse(occurredAt);
  const referenceTime = Number.isNaN(occurredAtTimestamp) ? Date.now() : occurredAtTimestamp;

  if (pendingSource) {
    delete state.pendingSources[tabId];
  }

  if (!pendingSource) {
    return null;
  }

  if (isIsoTimestampStale(pendingSource.createdAt, PENDING_SOURCE_TTL_MS, referenceTime)) {
    return null;
  }

  return pendingSource;
}

function upsertEdgeFallback(graph, fromNodeId, toNodeId, occurredAt, transitionType) {
  const edgeId = `${fromNodeId} -> ${toNodeId}`;

  if (!graph.edges[edgeId]) {
    graph.edges[edgeId] = {
      edgeId,
      fromNodeId,
      toNodeId,
      fromHost: graph.nodes[fromNodeId]?.host ?? fromNodeId,
      toHost: graph.nodes[toNodeId]?.host ?? toNodeId,
      count: 0,
      transitionStats: createEmptyTransitionStats(),
      dailyCounts: {},
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      lastTransitionType: transitionType,
    };
  }

  const edge = graph.edges[edgeId];
  edge.count += 1;
  edge.lastSeenAt = occurredAt;
  edge.lastTransitionType = transitionType;
  const dayKey = buildUtcDayKey(occurredAt);
  edge.dailyCounts[dayKey] = clampNonNegativeInt(edge.dailyCounts[dayKey], 0) + 1;
  recalculateEdgeTransitionStats(edge, occurredAt);
  registerEdgeInTransitionBuckets(graph, edge);
}
