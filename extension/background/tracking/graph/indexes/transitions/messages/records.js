function createTransitionMessageRecord(
  graph,
  event,
  previousNodeId,
  previousPageUrl,
  targetNodeId
) {
  const targetPageUrl = normalizePageUrlForIndex(event.url);

  return {
    sequenceNumber: graph.transitionSequence,
    fromNodeId: previousNodeId,
    toNodeId: targetNodeId,
    fromHost: previousNodeId ? graph.nodes[previousNodeId]?.host ?? previousNodeId : null,
    toHost: graph.nodes[targetNodeId]?.host ?? targetNodeId,
    fromPageUrl: previousPageUrl,
    toPageUrl: targetPageUrl || "",
    tabId: Number(event.tabId),
    occurredAt: event.occurredAt,
    eventType: event.eventType,
    transitionType: event.transitionType,
    url: targetPageUrl || event.url,
  };
}

function appendTransitionMessage(graph, transitionMessage) {
  graph.transitionMessages.push(transitionMessage);

  if (graph.transitionMessages.length > MAX_HOT_TRANSITION_MESSAGES) {
    graph.transitionMessages.splice(
      0,
      graph.transitionMessages.length - MAX_HOT_TRANSITION_MESSAGES
    );
  }
}

function replayTransitionMessageIntoEdgeCounts(graph, transitionMessage) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return;
  }

  upsertEdgeFallback(
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.toNodeId,
    transitionMessage.occurredAt || new Date().toISOString(),
    transitionMessage.transitionType || "unknown"
  );
}

globalThis.ZeroLatencyTransitionMessageRecords = {
  createTransitionMessageRecord,
  appendTransitionMessage,
  replayTransitionMessageIntoEdgeCounts,
};
