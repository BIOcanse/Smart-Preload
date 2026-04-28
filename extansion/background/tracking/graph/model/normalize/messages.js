function normalizeTransitionMessages(rawMessages) {
  const nextMessages = rawMessages
    .filter((message) => isPlainObject(message))
    .map((message, index) => normalizeTransitionMessageRecord(message, index))
    .sort(compareTransitionMessages);

  let nextSequence = 0;

  for (const transitionMessage of nextMessages) {
    if (transitionMessage.sequenceNumber <= nextSequence) {
      nextSequence += 1;
      transitionMessage.sequenceNumber = nextSequence;
      continue;
    }

    nextSequence = transitionMessage.sequenceNumber;
  }

  return nextMessages;
}

function normalizeTransitionMessageRecord(message, fallbackIndex) {
  const toPageUrl = normalizePageUrlForIndex(
    typeof message.toPageUrl === "string" ? message.toPageUrl : message.url
  );

  return {
    sequenceNumber: clampNonNegativeInt(message.sequenceNumber, fallbackIndex + 1),
    fromNodeId: typeof message.fromNodeId === "string" ? message.fromNodeId : null,
    toNodeId: typeof message.toNodeId === "string" ? message.toNodeId : "",
    fromHost: typeof message.fromHost === "string" ? message.fromHost : null,
    toHost: typeof message.toHost === "string" ? message.toHost : "",
    fromPageUrl: normalizePageUrlForIndex(message.fromPageUrl || ""),
    toPageUrl: toPageUrl || "",
    tabId: Number.isFinite(Number(message.tabId)) ? Number(message.tabId) : -1,
    occurredAt: typeof message.occurredAt === "string" ? message.occurredAt : "",
    eventType: typeof message.eventType === "string" ? message.eventType : "unknown",
    transitionType:
      typeof message.transitionType === "string" ? message.transitionType : "unknown",
    url: toPageUrl || (typeof message.url === "string" ? message.url : ""),
  };
}

function compareTransitionMessages(left, right) {
  if (left.sequenceNumber !== right.sequenceNumber) {
    return left.sequenceNumber - right.sequenceNumber;
  }

  return String(left.occurredAt).localeCompare(String(right.occurredAt));
}

function getMaxTransitionSequence(transitionMessages) {
  return transitionMessages.reduce(
    (maxSequence, transitionMessage) =>
      Math.max(maxSequence, clampNonNegativeInt(transitionMessage.sequenceNumber, 0)),
    0
  );
}

function getRecentTransitionPreview(graph) {
  return Array.isArray(graph.transitionMessages)
    ? graph.transitionMessages.slice(-MAX_DEBUG_TRANSITIONS).reverse()
    : [];
}

function getStoredTransitionMessageBucketLayer(rawTransitionMessageBuckets) {
  if (Array.isArray(rawTransitionMessageBuckets)) {
    return rawTransitionMessageBuckets;
  }

  if (Array.isArray(rawTransitionMessageBuckets?.buckets)) {
    return rawTransitionMessageBuckets.buckets;
  }

  return null;
}

function getTransitionMessageBucketLayer(graph) {
  if (!Array.isArray(graph.transitionMessageBuckets?.buckets)) {
    graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
  }

  return graph.transitionMessageBuckets.buckets;
}
