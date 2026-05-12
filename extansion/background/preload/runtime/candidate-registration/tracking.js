async function buildPreloadCandidateSelectionContext(message, sourceTab) {
  let trackingState = await loadTrackingState();
  trackingState = await ensureCurrentPageTrackedForPreloadCandidates(
    trackingState,
    String(sourceTab.id),
    message.pageUrl || sourceTab.url || ""
  );
  const sourceTabId = String(sourceTab.id);
  const currentNodeId =
    trackingState.tabState[sourceTabId]?.nodeId ??
    buildNodeSeed(message.pageUrl || sourceTab.url).nodeId;

  return {
    trackingState,
    sourceTabId,
    currentNodeId,
  };
}

async function ensureCurrentPageTrackedForPreloadCandidates(trackingState, tabId, pageUrl) {
  const normalizedPageUrl = normalizePageUrlForIndex(pageUrl);

  if (!normalizedPageUrl) {
    return trackingState;
  }

  const trackedTabState = trackingState.tabState?.[tabId] ?? null;
  const trackedPageUrl = normalizePageUrlForIndex(trackedTabState?.url || "");

  if (trackedPageUrl === normalizedPageUrl) {
    return trackingState;
  }

  return queueMutation(async () => {
    const latestTrackingState = await loadTrackingState();
    const latestTrackedPageUrl = normalizePageUrlForIndex(
      latestTrackingState.tabState?.[tabId]?.url || ""
    );

    if (latestTrackedPageUrl === normalizedPageUrl) {
      return latestTrackingState;
    }

    const nextTrackingState = await applyTrackingEvent(latestTrackingState, {
      type: "set-current-page",
      tabId,
      targetNode: buildNodeSeed(normalizedPageUrl),
      occurredAt: new Date().toISOString(),
      url: normalizedPageUrl,
    });

    await saveTrackingState(nextTrackingState);
    return nextTrackingState;
  });
}
