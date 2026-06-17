async function recordGoogleBookmarkPreloadNavigationIfNeeded(
  trackingState,
  {
    sourceTabId,
    sourceWindowId,
    sourcePageUrl,
    targetUrl,
    transitionType,
    occurredAt,
    settings,
  }
) {
  if (transitionType !== "auto_bookmark") {
    return false;
  }

  if (!settingsApi.isRuleCardEnabled(getGoogleBookmarkPreloadRuleCardState(settings))) {
    return false;
  }

  if (!isGoogleSearchPageForBookmarkPreload(sourcePageUrl)) {
    return false;
  }

  const targetPageUrl = normalizePageUrlForIndex(targetUrl || "");

  if (!targetPageUrl) {
    return false;
  }

  const bucketKey = await resolveGoogleBookmarkPreloadBucketKey({
    sourceUrl: sourcePageUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!bucketKey) {
    return false;
  }

  const didRecord = incrementBookmarkPreloadCount(
    trackingState?.graph,
    bucketKey,
    targetPageUrl
  );

  if (!didRecord) {
    return false;
  }

  trackingState.graph.updatedAt = occurredAt;
  recordGoogleBookmarkPreloadDiagnostic("tracking.google-bookmark.saved", {
    sourceTabId,
    sourcePageUrl,
    targetPageUrl,
    bucketKey,
    count: getBookmarkPreloadCount(trackingState.graph, bucketKey, targetPageUrl),
  });
  return true;
}

function getBookmarkPreloadCount(graph, bucketKey, targetPageUrl) {
  if (!bucketKey || !targetPageUrl) {
    return 0;
  }

  return clampNonNegativeInt(graph?.bookmarkPreloadBuckets?.[bucketKey]?.[targetPageUrl], 0);
}

function incrementBookmarkPreloadCount(graph, bucketKey, targetPageUrl) {
  if (!isPlainObject(graph) || !bucketKey || !targetPageUrl) {
    return false;
  }

  graph.bookmarkPreloadBuckets = normalizeBookmarkPreloadBuckets(
    graph.bookmarkPreloadBuckets
  );

  if (!isPlainObject(graph.bookmarkPreloadBuckets[bucketKey])) {
    graph.bookmarkPreloadBuckets[bucketKey] = {};
  }

  graph.bookmarkPreloadBuckets[bucketKey][targetPageUrl] =
    clampNonNegativeInt(graph.bookmarkPreloadBuckets[bucketKey][targetPageUrl], 0) + 1;
  return true;
}
