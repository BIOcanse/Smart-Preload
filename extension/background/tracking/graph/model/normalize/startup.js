function reconcileStartupTransitionCoverage(
  graph,
  storedVersion,
  storedEdgeSnapshots,
  storedTransitionMessageBucketLayer
) {
  if (storedVersion < 5 || !Array.isArray(storedTransitionMessageBucketLayer)) {
    return;
  }

  const recentMessages = graph.transitionMessages.slice(-STARTUP_SYNC_MESSAGE_WINDOW);

  for (const transitionMessage of recentMessages) {
    if (
      !shouldReplayTransitionMessageFromStartupCheck(
        graph,
        storedEdgeSnapshots,
        storedTransitionMessageBucketLayer,
        transitionMessage
      )
    ) {
      continue;
    }

    replayTransitionMessageIntoEdgeCounts(graph, transitionMessage);
  }
}

function shouldReplayTransitionMessageFromStartupCheck(
  graph,
  storedEdgeSnapshots,
  storedTransitionMessageBucketLayer,
  transitionMessage
) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return false;
  }

  const edgeId = `${transitionMessage.fromNodeId} -> ${transitionMessage.toNodeId}`;
  const storedEdgeSnapshot = storedEdgeSnapshots.get(edgeId) ?? null;

  if (!storedEdgeSnapshot) {
    return true;
  }

  if (
    hasStoredTransitionMessageReference(
      graph,
      storedTransitionMessageBucketLayer,
      transitionMessage
    )
  ) {
    return false;
  }

  return isOccurredAfter(transitionMessage.occurredAt, storedEdgeSnapshot.lastSeenAt);
}

function captureStoredEdgeSnapshots(rawEdges) {
  const snapshots = new Map();

  if (!isPlainObject(rawEdges)) {
    return snapshots;
  }

  for (const [edgeId, edge] of Object.entries(rawEdges)) {
    snapshots.set(edgeId, {
      lastSeenAt: typeof edge?.lastSeenAt === "string" ? edge.lastSeenAt : null,
    });
  }

  return snapshots;
}

function isOccurredAfter(leftOccurredAt, rightOccurredAt) {
  const left = Date.parse(leftOccurredAt || "");
  const right = Date.parse(rightOccurredAt || "");

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }

  return left > right;
}

function hasStoredTransitionMessageReference(
  graph,
  storedTransitionMessageBucketLayer,
  transitionMessage
) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return false;
  }

  const sourceMessages =
    storedTransitionMessageBucketLayer[getSourceBucketIndex(graph, transitionMessage.fromNodeId)]?.[
      transitionMessage.fromNodeId
    ]?.[transitionMessage.toNodeId];

  return Array.isArray(sourceMessages)
    ? sourceMessages.includes(transitionMessage.sequenceNumber)
    : false;
}
