(function () {
  function updateExistingHiddenTabEntryFromTarget(entry, target, liveTab) {
    entry.nodeId = target.nodeId;
    entry.score = target.score;
    entry.scoreBreakdown = target.scoreBreakdown ?? null;
    entry.transitionMetrics = target.transitionMetrics ?? null;
    entry.aiKeywordMatch = target.aiKeywordMatch ?? null;
    entry.bookmarkPreload = target.bookmarkPreload ?? null;
    entry.realPreloadSafety = target.realPreloadSafety ?? null;
    entry.interactionPreload =
      target.interactionPreload ?? entry.interactionPreload ?? null;
    entry.siteSelection = target.siteSelection ?? null;
    entry.status = liveTab.status || entry.status;
    entry.loadedUrl = liveTab.url || entry.loadedUrl;
    entry.updatedAt = new Date().toISOString();
    return entry;
  }

  function buildQueuedHiddenTabEntryFromTarget(target) {
    const timestamp = new Date().toISOString();

    return {
      tabId: null,
      requestedUrl: target.url,
      loadedUrl: null,
      nodeId: target.nodeId,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      realPreloadSafety: target.realPreloadSafety ?? null,
      interactionPreload: target.interactionPreload ?? null,
      siteSelection: target.siteSelection ?? null,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  globalThis.ZeroLatencyHiddenTabDiffEntries = {
    updateExistingHiddenTabEntryFromTarget,
    buildQueuedHiddenTabEntryFromTarget,
  };
})();
