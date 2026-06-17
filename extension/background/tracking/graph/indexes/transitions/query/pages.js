function getExternalPageTransitionCount(
  graph,
  windowKey,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl
) {
  return getPageTransitionCountFromBuckets(
    graph,
    graph?.externalPageTransitionBuckets,
    windowKey,
    sourceNodeId,
    sourcePageUrl,
    targetNodeId,
    targetPageUrl
  );
}

function getIntraSitePageTransitionCount(
  graph,
  windowKey,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl
) {
  return getPageTransitionCountFromBuckets(
    graph,
    graph?.intraSitePageTransitionBuckets,
    windowKey,
    sourceNodeId,
    sourcePageUrl,
    targetNodeId,
    targetPageUrl
  );
}

function getPageTransitionCountFromBuckets(
  graph,
  buckets,
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
      buckets?.total?.[getSourceBucketIndex(graph, sourceNodeId)]?.[sourceNodeId]?.[
        sourcePageUrl
      ]?.[targetNodeId]?.[targetPageUrl],
      0
    );
  }

  let total = 0;

  for (const dayKey of getTransitionWindowMatchingDayKeys(graph, windowKey, buckets)) {
    total += clampNonNegativeInt(
      buckets?.byDay?.[dayKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[sourceNodeId]?.[
        sourcePageUrl
      ]?.[targetNodeId]?.[targetPageUrl],
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

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const sourcePageMaps = [
    graph.externalPageTransitionBuckets?.total?.[bucketIndex]?.[sourceNodeId]?.[
      normalizedSourcePageUrl
    ],
    graph.intraSitePageTransitionBuckets?.total?.[bucketIndex]?.[sourceNodeId]?.[
      normalizedSourcePageUrl
    ],
    graph.pageTransitionBuckets?.total?.[bucketIndex]?.[sourceNodeId]?.[normalizedSourcePageUrl],
  ].filter(isPlainObject);
  const outgoingEntriesByKey = new Map();

  for (const sourcePageMap of sourcePageMaps) {
    for (const [destinationNodeId, destinationPages] of Object.entries(sourcePageMap)) {
      for (const [destinationPageUrl, count] of Object.entries(destinationPages || {})) {
        const entryKey = `${destinationNodeId}\n${destinationPageUrl}`;
        const existingEntry = outgoingEntriesByKey.get(entryKey);
        const nextCount =
          clampNonNegativeInt(existingEntry?.count, 0) + clampNonNegativeInt(count, 0);

        outgoingEntriesByKey.set(entryKey, {
          destinationNodeId,
          destinationPageUrl,
          destinationLabel: derivePageLabel(destinationPageUrl),
          destinationHost: graph.nodes[destinationNodeId]?.host ?? destinationNodeId,
          count: nextCount,
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
  }

  return [...outgoingEntriesByKey.values()];
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
