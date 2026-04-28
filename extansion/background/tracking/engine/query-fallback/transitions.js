function queryTransitionBucketFallback(graph, query) {
  const windowKey = normalizeTransitionWindowKey(query?.windowKey);
  const sourceNodeId = typeof query?.sourceNodeId === "string" ? query.sourceNodeId : "";

  if (!graph || !sourceNodeId) {
    return {
      windowKey,
      sourceNodeId,
      bucketIndex: null,
      targets: [],
    };
  }

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const sourceMap = getTransitionMapForSource(graph, windowKey, sourceNodeId);

  return {
    windowKey,
    sourceNodeId,
    bucketIndex,
    targets: Object.entries(sourceMap)
      .map(([targetNodeId, count]) => ({
        targetNodeId,
        count: clampNonNegativeInt(count, 0),
      }))
      .sort((left, right) => right.count - left.count),
  };
}

function queryTransitionMessageBucketFallback(graph, query) {
  const sourceNodeId = typeof query?.sourceNodeId === "string" ? query.sourceNodeId : "";
  const targetNodeId = typeof query?.targetNodeId === "string" ? query.targetNodeId : null;

  if (!graph || !sourceNodeId) {
    return {
      sourceNodeId,
      targetNodeId,
      bucketIndex: null,
      targets: [],
      sequenceNumbers: [],
    };
  }

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const sourceMap = graph.transitionMessageBuckets?.buckets?.[bucketIndex]?.[sourceNodeId] ?? {};

  if (targetNodeId) {
    return {
      sourceNodeId,
      targetNodeId,
      bucketIndex,
      sequenceNumbers: Array.isArray(sourceMap[targetNodeId])
        ? sourceMap[targetNodeId].slice()
        : [],
    };
  }

  return {
    sourceNodeId,
    targetNodeId: null,
    bucketIndex,
    targets: Object.entries(sourceMap).map(([nextTargetNodeId, sequenceNumbers]) => ({
      targetNodeId: nextTargetNodeId,
      sequenceNumbers: Array.isArray(sequenceNumbers) ? sequenceNumbers.slice() : [],
    })),
  };
}

function queryTransitionMessageFallback(graph, query) {
  const sequenceNumber = clampNonNegativeInt(query?.sequenceNumber, 0);

  if (!graph || sequenceNumber === 0) {
    return null;
  }

  return (
    graph.transitionMessages.find(
      (transitionMessage) => transitionMessage.sequenceNumber === sequenceNumber
    ) ?? null
  );
}

function queryRecentTransitionMessagesFallback(graph, query) {
  const limit = Math.max(1, clampNonNegativeInt(query?.limit, 20));

  if (!graph) {
    return [];
  }

  return graph.transitionMessages.slice(-limit);
}

function queryCandidateTransitionMetricsBatchFallback(graph, query) {
  const windowKey = normalizeTransitionWindowKey(query?.windowKey);
  const sourceNodeId = typeof query?.sourceNodeId === "string" ? query.sourceNodeId : "";
  const sourcePageUrl = typeof query?.sourcePageUrl === "string" ? query.sourcePageUrl : "";
  const rawCandidates = Array.isArray(query?.candidates) ? query.candidates : [];

  return {
    windowKey,
    sourceNodeId,
    sourcePageUrl,
    candidates: rawCandidates.map((candidate) => {
      const targetNodeId = typeof candidate?.targetNodeId === "string" ? candidate.targetNodeId : "";
      const targetPageUrl = typeof candidate?.targetPageUrl === "string" ? candidate.targetPageUrl : "";
      const isSameOriginCandidate = isSameOriginPageTransition(sourcePageUrl, targetPageUrl);
      const siteTransitionCount =
        sourceNodeId && targetNodeId
          ? getTransitionCount(graph, windowKey, sourceNodeId, targetNodeId)
          : 0;
      const pageTransitionCount =
        sourceNodeId && sourcePageUrl && targetNodeId && targetPageUrl
          ? getPageTransitionCount(
              graph,
              windowKey,
              sourceNodeId,
              sourcePageUrl,
              targetNodeId,
              targetPageUrl
            )
          : 0;
      const outboundPageTransitionCount = isSameOriginCandidate ? 0 : pageTransitionCount;
      const intraSitePageTransitionCount = isSameOriginCandidate ? pageTransitionCount : 0;

      return {
        url: typeof candidate?.url === "string" ? candidate.url : "",
        targetNodeId,
        targetPageUrl,
        isSameOriginCandidate,
        siteTransitionCount,
        pageTransitionCount,
        outboundPageTransitionCount,
        intraSitePageTransitionCount,
        transitionCount: isSameOriginCandidate
          ? intraSitePageTransitionCount
          : outboundPageTransitionCount,
      };
    }),
  };
}

function isSameOriginPageTransition(sourcePageUrl, targetPageUrl) {
  try {
    return new URL(sourcePageUrl).origin === new URL(targetPageUrl).origin;
  } catch (_error) {
    return false;
  }
}

function normalizeTransitionWindowKey(windowKey) {
  return TRANSITION_WINDOW_KEYS.includes(windowKey) ? windowKey : "total";
}
