async function buildGoogleBookmarkPreloadTargets({
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  graph,
  settings,
}) {
  const context = await resolveGoogleBookmarkPreloadTargetContext({
    settings,
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!context) {
    return [];
  }

  const rankedEntries = rankGoogleBookmarkPreloadEntries(
    context.bookmarkEntries,
    graph,
    context.bucketKey
  );
  const selectedEntries = filterGoogleBookmarkPreloadEntriesByRankRule(
    rankedEntries,
    settings
  );

  recordGoogleBookmarkPreloadTargetDiagnostic({
    sourceUrl,
    bucketKey: context.bucketKey,
    bookmarkEntries: context.bookmarkEntries,
    rankedEntries,
    selectedEntries,
  });

  return selectedEntries.map((entry) =>
    buildGoogleBookmarkPreloadTarget({
      entry,
      bucketKey: context.bucketKey,
      settings,
    })
  );
}
