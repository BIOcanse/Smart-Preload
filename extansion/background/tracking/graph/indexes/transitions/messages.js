function registerTransitionMessageInBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.sequenceNumber
  ) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, transitionMessage.fromNodeId);
  const bucketLayer = getTransitionMessageBucketLayer(graph);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap = bucket[transitionMessage.fromNodeId] || (bucket[transitionMessage.fromNodeId] = {});
  const targetMessages = sourceMap[transitionMessage.toNodeId] || (sourceMap[transitionMessage.toNodeId] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

function registerTransitionMessageInDayGroups(graph, transitionMessage) {
  if (!transitionMessage?.sequenceNumber) {
    return;
  }

  const dayKey = buildUtcDayKey(transitionMessage.occurredAt);
  const dayMessages = graph.transitionMessagesByDay?.[dayKey] || (graph.transitionMessagesByDay[dayKey] = []);

  if (dayMessages[dayMessages.length - 1] !== transitionMessage.sequenceNumber) {
    dayMessages.push(transitionMessage.sequenceNumber);
  }
}

function registerTransitionMessageInPageIndexes(graph, transitionMessage) {
  registerTransitionCountBuckets(graph, transitionMessage);
  registerPageTransitionCountBuckets(graph, transitionMessage);
  registerPageTransitionMessageBuckets(graph, transitionMessage);
}

function registerTransitionCountBuckets(graph, transitionMessage) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return;
  }

  incrementTransitionBucketCount(
    graph.transitionBuckets.total,
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.toNodeId,
    1
  );

  incrementTransitionBucketCount(
    getTransitionBucketDayLayer(graph, buildUtcDayKey(transitionMessage.occurredAt)),
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.toNodeId,
    1
  );
}

function registerPageTransitionCountBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.fromPageUrl ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.toPageUrl
  ) {
    return;
  }

  incrementPageTransitionBucketCount(
    graph.pageTransitionBuckets.total,
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.fromPageUrl,
    transitionMessage.toNodeId,
    transitionMessage.toPageUrl,
    1
  );

  incrementPageTransitionBucketCount(
    getPageTransitionBucketDayLayer(graph, buildUtcDayKey(transitionMessage.occurredAt)),
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.fromPageUrl,
    transitionMessage.toNodeId,
    transitionMessage.toPageUrl,
    1
  );
}

function registerPageTransitionMessageBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.fromPageUrl ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.toPageUrl ||
    !transitionMessage?.sequenceNumber
  ) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, transitionMessage.fromNodeId);
  const bucketLayer = getPageTransitionMessageBucketLayer(graph);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceSiteMap = bucket[transitionMessage.fromNodeId] || (bucket[transitionMessage.fromNodeId] = {});
  const sourcePageMap =
    sourceSiteMap[transitionMessage.fromPageUrl] || (sourceSiteMap[transitionMessage.fromPageUrl] = {});
  const targetSiteMap =
    sourcePageMap[transitionMessage.toNodeId] || (sourcePageMap[transitionMessage.toNodeId] = {});
  const targetMessages =
    targetSiteMap[transitionMessage.toPageUrl] || (targetSiteMap[transitionMessage.toPageUrl] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

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
}

function replayTransitionMessageIntoEdgeCounts(graph, transitionMessage) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return;
  }

  const edgeId = `${transitionMessage.fromNodeId} -> ${transitionMessage.toNodeId}`;
  const edge = graph.edges[edgeId];

  if (!edge) {
    return;
  }

  edge.count = clampNonNegativeInt(edge.count, 0) + 1;
  edge.lastSeenAt = transitionMessage.occurredAt || edge.lastSeenAt;
  edge.lastTransitionType = transitionMessage.transitionType || edge.lastTransitionType;
  const dayKey = buildUtcDayKey(transitionMessage.occurredAt);
  edge.dailyCounts = normalizeDailyCounts({
    ...(isPlainObject(edge.dailyCounts) ? edge.dailyCounts : {}),
    [dayKey]: clampNonNegativeInt(edge.dailyCounts?.[dayKey], 0) + 1,
  });
  recalculateEdgeTransitionStats(edge, transitionMessage.occurredAt || new Date().toISOString());
  applyTransitionMessageToIndexes(graph, transitionMessage);
}

function applyTransitionMessageToIndexes(graph, transitionMessage) {
  registerTransitionMessageInDayGroups(graph, transitionMessage);
  registerTransitionMessageInBuckets(graph, transitionMessage);
  registerTransitionMessageInPageIndexes(graph, transitionMessage);
}
