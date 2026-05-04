function registerEdgeInTransitionBuckets(graph, edge) {
  if (!edge?.fromNodeId || !edge?.toNodeId || !edge?.edgeId) {
    return;
  }

  if (edge.fromNodeId === edge.toNodeId) {
    return;
  }

  setTransitionBucketCount(
    graph.transitionBuckets.total,
    graph,
    edge.fromNodeId,
    edge.toNodeId,
    getEdgeTotalCount(edge)
  );
}

function setTransitionBucketCount(bucketLayer, graph, sourceNodeId, targetNodeId, count) {
  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap = bucket[sourceNodeId] || (bucket[sourceNodeId] = {});

  if (count > 0) {
    sourceMap[targetNodeId] = count;
    return;
  }

  delete sourceMap[targetNodeId];

  if (!Object.keys(sourceMap).length) {
    delete bucket[sourceNodeId];
  }
}

function getPageTransitionMessageBucketLayer(graph) {
  if (!Array.isArray(graph.pageTransitionMessageBuckets?.buckets)) {
    graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();
  }

  return graph.pageTransitionMessageBuckets.buckets;
}

function ensurePageTransitionBuckets(rawBuckets) {
  if (!isPlainObject(rawBuckets) || !Array.isArray(rawBuckets.total)) {
    return createEmptyPageTransitionBuckets();
  }

  if (!isPlainObject(rawBuckets.byDay)) {
    rawBuckets.byDay = {};
  }

  return rawBuckets;
}

function incrementPageTransitionBucketCount(
  bucketLayer,
  graph,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl,
  delta
) {
  if (!Array.isArray(bucketLayer) || !sourceNodeId || !sourcePageUrl || !targetNodeId || !targetPageUrl) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceSiteMap = bucket[sourceNodeId] || (bucket[sourceNodeId] = {});
  const sourcePageMap = sourceSiteMap[sourcePageUrl] || (sourceSiteMap[sourcePageUrl] = {});
  const targetSiteMap = sourcePageMap[targetNodeId] || (sourcePageMap[targetNodeId] = {});
  targetSiteMap[targetPageUrl] = clampNonNegativeInt(targetSiteMap[targetPageUrl], 0) + delta;
}

function incrementTransitionBucketCount(bucketLayer, graph, sourceNodeId, targetNodeId, delta) {
  if (!Array.isArray(bucketLayer) || !sourceNodeId || !targetNodeId) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap = bucket[sourceNodeId] || (bucket[sourceNodeId] = {});
  sourceMap[targetNodeId] = clampNonNegativeInt(sourceMap[targetNodeId], 0) + delta;
}

function getTransitionBucketDayLayer(graph, dayKey) {
  if (!isPlainObject(graph.transitionBuckets?.byDay)) {
    graph.transitionBuckets = createEmptyTransitionBuckets();
  }

  return graph.transitionBuckets.byDay[dayKey] || (graph.transitionBuckets.byDay[dayKey] = createEmptyBucketLayer());
}

function getExternalPageTransitionBucketDayLayer(graph, dayKey) {
  graph.externalPageTransitionBuckets = ensurePageTransitionBuckets(
    graph.externalPageTransitionBuckets
  );

  return (
    graph.externalPageTransitionBuckets.byDay[dayKey] ||
    (graph.externalPageTransitionBuckets.byDay[dayKey] = createEmptyPageBucketLayer())
  );
}

function getIntraSitePageTransitionBucketDayLayer(graph, dayKey) {
  graph.intraSitePageTransitionBuckets = ensurePageTransitionBuckets(
    graph.intraSitePageTransitionBuckets
  );

  return (
    graph.intraSitePageTransitionBuckets.byDay[dayKey] ||
    (graph.intraSitePageTransitionBuckets.byDay[dayKey] = createEmptyPageBucketLayer())
  );
}

function getSourceBucketIndex(graph, sourceNodeId) {
  const bucketText = deriveBucketText(graph, sourceNodeId);
  const primaryIndex = getBucketCharIndex(bucketText[0]);
  const secondaryIndex =
    bucketText.length > 1
      ? getBucketCharIndex(bucketText[1])
      : BUCKET_SECONDARY_BLANK_INDEX;

  return primaryIndex * (BUCKET_PRIMARY_CHARSET.length + 1) + secondaryIndex;
}

function deriveBucketText(graph, sourceNodeId) {
  const sourceNode = graph.nodes?.[sourceNodeId] ?? {};
  const sourceHost = sourceNode.hostname || sourceNode.host || sourceNodeId || "";
  const normalizedHost = String(sourceHost || "")
    .toLowerCase()
    .trim()
    .replace(/^www\./u, "");

  if (!normalizedHost) {
    return "__";
  }

  const firstChar = normalizeBucketChar(normalizedHost[0]);
  const secondChar = normalizedHost.length > 1 ? normalizeBucketChar(normalizedHost[1]) : "";

  return `${firstChar}${secondChar}`;
}

function normalizeBucketChar(character) {
  const normalizedCharacter = String(character || "_").toLowerCase();
  return BUCKET_PRIMARY_CHARSET.includes(normalizedCharacter) ? normalizedCharacter : "_";
}

function getBucketCharIndex(character) {
  const normalizedCharacter = normalizeBucketChar(character);
  const index = BUCKET_PRIMARY_CHARSET.indexOf(normalizedCharacter);
  return index === -1 ? BUCKET_PRIMARY_CHARSET.indexOf("_") : index;
}
