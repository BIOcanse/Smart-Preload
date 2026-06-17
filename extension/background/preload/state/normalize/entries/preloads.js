(function () {
  function normalizeHiddenTabPreloadEntry(rawEntry) {
    const nextEntry = isPlainObject(rawEntry) ? rawEntry : {};

    return {
      tabId: normalizePositiveInteger(nextEntry.tabId),
      requestedUrl: typeof nextEntry.requestedUrl === "string" ? nextEntry.requestedUrl : "",
      loadedUrl: typeof nextEntry.loadedUrl === "string" ? nextEntry.loadedUrl : null,
      nodeId: typeof nextEntry.nodeId === "string" ? nextEntry.nodeId : "",
      score: clampNonNegativeNumber(nextEntry.score, 0),
      scoreBreakdown: normalizeScoreBreakdown(nextEntry.scoreBreakdown),
      transitionMetrics: normalizeTransitionMetrics(nextEntry.transitionMetrics),
      status: typeof nextEntry.status === "string" ? nextEntry.status : "queued",
      aiKeywordMatch: normalizeAiKeywordMatch(nextEntry.aiKeywordMatch),
      bookmarkPreload: normalizeBookmarkPreloadMetadata(nextEntry.bookmarkPreload),
      realPreloadSafety: normalizeRealPreloadSafety(nextEntry.realPreloadSafety),
      interactionPreload: normalizeInteractionPreloadMetadata(nextEntry.interactionPreload),
      siteSelection: normalizeSiteSelection(nextEntry.siteSelection),
      createdAt: typeof nextEntry.createdAt === "string" ? nextEntry.createdAt : null,
      updatedAt: typeof nextEntry.updatedAt === "string" ? nextEntry.updatedAt : null,
    };
  }

  function normalizeSyntheticPreloadEntry(rawEntry, strategy) {
    const nextEntry = isPlainObject(rawEntry) ? rawEntry : {};

    return {
      requestedUrl: typeof nextEntry.requestedUrl === "string" ? nextEntry.requestedUrl : "",
      nodeId: typeof nextEntry.nodeId === "string" ? nextEntry.nodeId : "",
      score: clampNonNegativeNumber(nextEntry.score, 0),
      scoreBreakdown: normalizeScoreBreakdown(nextEntry.scoreBreakdown),
      transitionMetrics: normalizeTransitionMetrics(nextEntry.transitionMetrics),
      status: typeof nextEntry.status === "string" ? nextEntry.status : strategy,
      strategy,
      targetHint: typeof nextEntry.targetHint === "string" ? nextEntry.targetHint : null,
      aiKeywordMatch: normalizeAiKeywordMatch(nextEntry.aiKeywordMatch),
      bookmarkPreload: normalizeBookmarkPreloadMetadata(nextEntry.bookmarkPreload),
      realPreloadSafety: normalizeRealPreloadSafety(nextEntry.realPreloadSafety),
      interactionPreload: normalizeInteractionPreloadMetadata(nextEntry.interactionPreload),
      siteSelection: normalizeSiteSelection(nextEntry.siteSelection),
      updatedAt: typeof nextEntry.updatedAt === "string" ? nextEntry.updatedAt : null,
    };
  }

  globalThis.normalizeHiddenTabPreloadEntry = normalizeHiddenTabPreloadEntry;
  globalThis.normalizeSyntheticPreloadEntry = normalizeSyntheticPreloadEntry;
})();
