(function () {
  async function recordForegroundPageIfNeeded(context) {
    const trackingState = await loadTrackingState();
    const shouldRecordForegroundPage = shouldRefreshForegroundPageRecord(
      trackingState.graph,
      context.pageUrl,
      context.contentFingerprint,
      context.title,
      context.textDigest
    );

    if (!shouldRecordForegroundPage) {
      return trackingState;
    }

    return queueMutation(async () => {
      const latestTrackingState = await loadTrackingState();
      const refreshedTrackingState = await applyTrackingEvent(latestTrackingState, {
        type: "record-foreground-page",
        tabId: String(context.sourceTab.id),
        windowId: String(context.sourceTab.windowId ?? -1),
        nodeId: context.nodeId,
        pageUrl: context.pageUrl,
        title: context.title,
        textDigest: context.textDigest,
        contentFingerprint: context.contentFingerprint,
        occurredAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        wasPreloadedBeforeForeground:
          findPreloadEntryByTabId(context.preloadState, context.sourceTab.id) !== null,
      });
      await saveTrackingState(refreshedTrackingState);
      return refreshedTrackingState;
    });
  }

  function shouldRefreshForegroundPageRecord(
    graph,
    pageUrl,
    contentFingerprint,
    title,
    textDigest
  ) {
    const mostRecentForegroundPage = Array.isArray(graph?.recentForegroundPages)
      ? graph.recentForegroundPages[0]
      : null;

    if (!mostRecentForegroundPage || mostRecentForegroundPage.pageUrl !== pageUrl) {
      return true;
    }

    return (
      String(mostRecentForegroundPage.contentFingerprint || "") !== String(contentFingerprint || "") ||
      String(mostRecentForegroundPage.title || "") !== String(title || "") ||
      String(mostRecentForegroundPage.textDigest || "") !== String(textDigest || "")
    );
  }

  globalThis.ZeroLatencyLearningForegroundPageRecord = {
    recordForegroundPageIfNeeded,
    shouldRefreshForegroundPageRecord,
  };
})();
