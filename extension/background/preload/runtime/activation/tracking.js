async function recordActivatedPreloadedTransition({
  trackingState,
  sourceTab,
  activatedTab,
  targetUrl,
  keepSourceTab = false,
}) {
  let nextState = trackingState;
  const sourceTabId = String(sourceTab.id);
  const sourceNodeId =
    nextState.tabState[sourceTabId]?.nodeId ??
    (isTrackableAndAllowedUrl(sourceTab.url || "") ? buildNodeSeed(sourceTab.url).nodeId : null);
  const activatedTabId = String(activatedTab.id);
  const occurredAt = new Date().toISOString();
  const normalizedTargetUrl = normalizePageUrlForIndex(targetUrl);

  if (sourceNodeId) {
    nextState.pendingSources[activatedTabId] = {
      nodeId: sourceNodeId,
      pageUrl: normalizePageUrlForIndex(sourceTab.url || ""),
      createdAt: occurredAt,
    };
  }

  nextState = await applyTrackingEvent(nextState, {
    type: "record-visit",
    tabId: activatedTabId,
    targetNode: buildNodeSeed(targetUrl),
    occurredAt,
    eventType: "preloaded-tab-activation",
    transitionType: "link",
    url: normalizedTargetUrl || targetUrl,
  });

  if (!keepSourceTab) {
    nextState = await applyTrackingEvent(nextState, {
      type: "remove-tab",
      tabId: sourceTabId,
    });
  }

  return nextState;
}
