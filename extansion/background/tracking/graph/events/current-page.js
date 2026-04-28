function applySetCurrentPageFallback(state, event) {
  const tabId = event.tabId;
  const targetNodeId = event.targetNode.nodeId;
  const previousNodeId = state.tabState[tabId]?.nodeId ?? null;
  const previousPageUrl = normalizePageUrlForIndex(state.tabState[tabId]?.url || "");
  const targetPageUrl = normalizePageUrlForIndex(event.url);
  const isNewNodeVisit = previousNodeId === null || previousNodeId !== targetNodeId;
  const isNewPageVisit = previousPageUrl !== targetPageUrl;

  upsertNodeFallback(state.graph, event.targetNode, event.occurredAt);

  if (isNewNodeVisit) {
    state.graph.nodes[targetNodeId].visitCount += 1;
  }

  if (isNewNodeVisit || isNewPageVisit) {
    state.graph.updatedAt = event.occurredAt;
  }

  state.tabState[tabId] = {
    nodeId: targetNodeId,
    url: event.url,
    updatedAt: event.occurredAt,
  };

  return state;
}

function upsertNodeFallback(graph, targetNode, occurredAt) {
  const normalizedLandingPageUrl =
    normalizePageUrlForIndex(targetNode.sampleUrl || "") || targetNode.sampleUrl || "";

  if (!graph.nodes[targetNode.nodeId]) {
    graph.nodes[targetNode.nodeId] = {
      nodeId: targetNode.nodeId,
      origin: targetNode.origin,
      host: targetNode.host,
      hostname: targetNode.hostname,
      protocol: targetNode.protocol,
      sampleUrl: targetNode.sampleUrl,
      defaultLandingPageUrl: normalizedLandingPageUrl,
      visitCount: 0,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
    };

    return;
  }

  graph.nodes[targetNode.nodeId].lastSeenAt = occurredAt;
  graph.nodes[targetNode.nodeId].sampleUrl = targetNode.sampleUrl;
  if (!graph.nodes[targetNode.nodeId].defaultLandingPageUrl) {
    graph.nodes[targetNode.nodeId].defaultLandingPageUrl = normalizedLandingPageUrl;
  }
}
