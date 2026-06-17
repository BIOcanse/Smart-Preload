function rankGoogleBookmarkPreloadEntries(bookmarkEntries, graph, bucketKey) {
  return bookmarkEntries
    .map((entry) => ({
      ...entry,
      count: getBookmarkPreloadCount(graph, bucketKey, entry.targetPageUrl),
    }))
    .sort(compareBookmarkPreloadEntryPriority)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function filterGoogleBookmarkPreloadEntriesByRankRule(rankedEntries, settings) {
  const bookmarkRuleCardState = getGoogleBookmarkPreloadRuleCardState(settings);

  if (!settingsApi.isRuleCardEnabled(bookmarkRuleCardState)) {
    return [];
  }

  return (Array.isArray(rankedEntries) ? rankedEntries : []).filter((entry) =>
    settingsApi.evaluateRuleCardMetric(
      bookmarkRuleCardState,
      clampNonNegativeInt(entry?.rank, 0)
    ) &&
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
      entry?.url,
      settings
    ) !== true
  );
}

function recordGoogleBookmarkPreloadTargetDiagnostic({
  sourceUrl,
  bucketKey,
  bookmarkEntries,
  rankedEntries,
  selectedEntries,
}) {
  recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.targets", {
    sourceUrl,
    bucketKey,
    bookmarkCount: bookmarkEntries.length,
    rankedCount: rankedEntries.length,
    selectedCount: selectedEntries.length,
    topBookmarks: selectedEntries.slice(0, 8).map((entry) => ({
      rank: entry.rank,
      url: entry.url,
      count: entry.count,
      title: entry.title,
    })),
  });
}

function buildGoogleBookmarkPreloadTarget({
  entry,
  bucketKey,
  settings,
}) {
  const targetNodeId = buildNodeSeed(entry.url).nodeId;

  return {
    url: entry.url,
    nodeId: targetNodeId,
    score: 0,
    scoreBreakdown: null,
    transitionMetrics: null,
    targetHint: "_self",
    aiKeywordMatch: null,
    bookmarkPreload: {
      bucketKey,
      count: entry.count,
      rank: entry.rank,
      title: entry.title,
    },
    siteSelection: null,
    strategy:
      globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.resolveHiddenTabStrategyForNativeOnlyMode?.(
        "hidden-tab",
        settings
      ) ?? "hidden-tab",
  };
}

function compareBookmarkPreloadEntryPriority(left, right) {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return left.bookmarkIndex - right.bookmarkIndex;
}
