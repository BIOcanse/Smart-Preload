function getPageTransitionCount(
  graph,
  windowKey,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl
) {
  if (!sourceNodeId || !sourcePageUrl || !targetNodeId || !targetPageUrl) {
    return 0;
  }

  if (windowKey === "total") {
    return clampNonNegativeInt(
      graph.pageTransitionBuckets?.total?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
        sourceNodeId
      ]?.[sourcePageUrl]?.[targetNodeId]?.[targetPageUrl],
      0
    );
  }

  let total = 0;

  for (const dayKey of getTransitionWindowMatchingDayKeys(graph, windowKey)) {
    total += clampNonNegativeInt(
      graph.pageTransitionBuckets?.byDay?.[dayKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
        sourceNodeId
      ]?.[sourcePageUrl]?.[targetNodeId]?.[targetPageUrl],
      0
    );
  }

  return total;
}

function getOutgoingPageEntriesForSource(graph, sourceNodeId, sourcePageUrl) {
  const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || "");

  if (!sourceNodeId || !normalizedSourcePageUrl) {
    return [];
  }

  const sourcePageMap =
    graph.pageTransitionBuckets?.total?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[normalizedSourcePageUrl] ?? {};
  const outgoingEntries = [];

  for (const [destinationNodeId, destinationPages] of Object.entries(sourcePageMap)) {
    for (const [destinationPageUrl, count] of Object.entries(destinationPages || {})) {
      outgoingEntries.push({
        destinationNodeId,
        destinationPageUrl,
        destinationLabel: derivePageLabel(destinationPageUrl),
        destinationHost: graph.nodes[destinationNodeId]?.host ?? destinationNodeId,
        count: clampNonNegativeInt(count, 0),
        lastSeenAt: getLastSeenAtForPageTransition(
          graph,
          sourceNodeId,
          normalizedSourcePageUrl,
          destinationNodeId,
          destinationPageUrl
        ),
        lastTransitionType: getLastTransitionTypeForPageTransition(
          graph,
          sourceNodeId,
          normalizedSourcePageUrl,
          destinationNodeId,
          destinationPageUrl
        ),
      });
    }
  }

  return outgoingEntries;
}

function getLastSeenAtForPageTransition(
  graph,
  sourceNodeId,
  sourcePageUrl,
  destinationNodeId,
  destinationPageUrl
) {
  const sequenceNumbers =
    graph.pageTransitionMessageBuckets?.buckets?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[sourcePageUrl]?.[destinationNodeId]?.[destinationPageUrl] ?? [];
  const latestSequence = Array.isArray(sequenceNumbers)
    ? sequenceNumbers[sequenceNumbers.length - 1]
    : null;

  if (!latestSequence) {
    return null;
  }

  const recentMessage = graph.transitionMessages.find(
    (transitionMessage) => transitionMessage.sequenceNumber === latestSequence
  );
  return recentMessage?.occurredAt ?? null;
}

function getLastTransitionTypeForPageTransition(
  graph,
  sourceNodeId,
  sourcePageUrl,
  destinationNodeId,
  destinationPageUrl
) {
  const sequenceNumbers =
    graph.pageTransitionMessageBuckets?.buckets?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[sourcePageUrl]?.[destinationNodeId]?.[destinationPageUrl] ?? [];
  const latestSequence = Array.isArray(sequenceNumbers)
    ? sequenceNumbers[sequenceNumbers.length - 1]
    : null;

  if (!latestSequence) {
    return "unknown";
  }

  const recentMessage = graph.transitionMessages.find(
    (transitionMessage) => transitionMessage.sequenceNumber === latestSequence
  );
  return recentMessage?.transitionType ?? "unknown";
}
