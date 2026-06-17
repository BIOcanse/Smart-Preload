function registerTransitionMessageInPageIndexes(graph, transitionMessage) {
  registerTransitionCountBuckets(graph, transitionMessage);
  registerExternalPageTransitionCountBuckets(graph, transitionMessage);
  registerIntraSitePageTransitionCountBuckets(graph, transitionMessage);
  registerPageTransitionMessageBuckets(graph, transitionMessage);
}

function registerTransitionCountBuckets(graph, transitionMessage) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return;
  }

  if (!isExternalSiteTransitionMessage(transitionMessage)) {
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

function registerExternalPageTransitionCountBuckets(graph, transitionMessage) {
  if (!isExternalSiteTransitionMessage(transitionMessage)) {
    return;
  }

  registerPageTransitionCountInBuckets(
    graph,
    transitionMessage,
    "externalPageTransitionBuckets",
    getExternalPageTransitionBucketDayLayer
  );
}

function registerIntraSitePageTransitionCountBuckets(graph, transitionMessage) {
  if (!isIntraSiteTransitionMessage(transitionMessage)) {
    return;
  }

  registerPageTransitionCountInBuckets(
    graph,
    transitionMessage,
    "intraSitePageTransitionBuckets",
    getIntraSitePageTransitionBucketDayLayer
  );
}

function registerPageTransitionCountInBuckets(
  graph,
  transitionMessage,
  bucketProperty,
  getDayLayer
) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.fromPageUrl ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.toPageUrl
  ) {
    return;
  }

  graph[bucketProperty] = ensurePageTransitionBuckets(graph[bucketProperty]);

  incrementPageTransitionBucketCount(
    graph[bucketProperty].total,
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.fromPageUrl,
    transitionMessage.toNodeId,
    transitionMessage.toPageUrl,
    1
  );

  incrementPageTransitionBucketCount(
    getDayLayer(graph, buildUtcDayKey(transitionMessage.occurredAt)),
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.fromPageUrl,
    transitionMessage.toNodeId,
    transitionMessage.toPageUrl,
    1
  );
}

function isExternalSiteTransitionMessage(transitionMessage) {
  return (
    typeof transitionMessage?.fromNodeId === "string" &&
    typeof transitionMessage?.toNodeId === "string" &&
    transitionMessage.fromNodeId.length > 0 &&
    transitionMessage.toNodeId.length > 0 &&
    transitionMessage.fromNodeId !== transitionMessage.toNodeId
  );
}

function isIntraSiteTransitionMessage(transitionMessage) {
  return (
    typeof transitionMessage?.fromNodeId === "string" &&
    typeof transitionMessage?.toNodeId === "string" &&
    transitionMessage.fromNodeId.length > 0 &&
    transitionMessage.toNodeId.length > 0 &&
    transitionMessage.fromNodeId === transitionMessage.toNodeId
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
  const sourceSiteMap =
    bucket[transitionMessage.fromNodeId] || (bucket[transitionMessage.fromNodeId] = {});
  const sourcePageMap =
    sourceSiteMap[transitionMessage.fromPageUrl] ||
    (sourceSiteMap[transitionMessage.fromPageUrl] = {});
  const targetSiteMap =
    sourcePageMap[transitionMessage.toNodeId] ||
    (sourcePageMap[transitionMessage.toNodeId] = {});
  const targetMessages =
    targetSiteMap[transitionMessage.toPageUrl] ||
    (targetSiteMap[transitionMessage.toPageUrl] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

globalThis.ZeroLatencyTransitionMessagePageIndexes = {
  registerTransitionMessageInPageIndexes,
  registerTransitionCountBuckets,
  registerExternalPageTransitionCountBuckets,
  registerIntraSitePageTransitionCountBuckets,
  registerPageTransitionMessageBuckets,
};
