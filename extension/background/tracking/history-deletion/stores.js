function deleteRecentForegroundPagesInRange(graph, range) {
  const entries = Array.isArray(graph.recentForegroundPages) ? graph.recentForegroundPages : [];
  graph.recentForegroundPages = entries.filter(
    (entry) =>
      !(
        isIsoTimestampInRange(entry?.activatedAt, range) ||
        isIsoTimestampInRange(entry?.leftForegroundAt, range)
      )
  );
  return entries.length - graph.recentForegroundPages.length;
}

function deletePageKeywordsInRange(graph, range) {
  let deletedCount = 0;
  const nextStore = {};

  for (const [pageUrl, entry] of Object.entries(graph.pageKeywordStore || {})) {
    if (isIsoTimestampInRange(entry?.generatedAt, range)) {
      deletedCount += 1;
      continue;
    }

    nextStore[pageUrl] = entry;
  }

  graph.pageKeywordStore = nextStore;
  return deletedCount;
}

function deleteLinkBehaviorRecordsInRange(graph, range) {
  let deletedCount = 0;
  const nextStore = {};

  for (const [sourcePageUrl, targetMap] of Object.entries(graph.linkBehaviorStore || {})) {
    if (!isPlainObject(targetMap)) {
      continue;
    }

    const nextTargetMap = {};

    for (const [targetUrl, record] of Object.entries(targetMap)) {
      if (isIsoTimestampInRange(record?.lastSeenAt, range)) {
        deletedCount += 1;
        continue;
      }

      nextTargetMap[targetUrl] = record;
    }

    if (Object.keys(nextTargetMap).length > 0) {
      nextStore[sourcePageUrl] = nextTargetMap;
    }
  }

  graph.linkBehaviorStore = nextStore;
  return deletedCount;
}
