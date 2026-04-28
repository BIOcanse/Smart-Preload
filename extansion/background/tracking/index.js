async function recordVisit(details, sourceEvent) {
  if (!isTrackableAndAllowedUrl(details.url)) {
    return;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId)) {
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-visit",
    tabId: String(details.tabId),
    targetNode: buildNodeSeed(details.url),
    occurredAt: toIsoTimestamp(details.timeStamp),
    eventType: sourceEvent,
    transitionType: details.transitionType || "unknown",
    url: details.url,
  });

  await saveTrackingState(nextTrackingState);
}

async function recordCreatedNavigationTarget(details) {
  if (!isTrackableAndAllowedUrl(details.url)) {
    return;
  }

  const preloadState = await loadPreloadState();

  if (
    isPreloadTab(preloadState, details.sourceTabId) ||
    isPreloadTab(preloadState, details.tabId)
  ) {
    return;
  }

  const trackingState = await loadTrackingState();
  let nextTrackingState = trackingState;
  nextTrackingState =
    await globalThis.ZeroLatencyLearning.applyCreatedNavigationTargetLinkBehavior(
      nextTrackingState,
      details
    );

  nextTrackingState = await applyTrackingEvent(nextTrackingState, {
    type: "record-created-navigation-target",
    sourceTabId: String(details.sourceTabId),
    targetTabId: String(details.tabId),
    occurredAt: toIsoTimestamp(details.timeStamp),
  });

  await saveTrackingState(nextTrackingState);
}

async function recordTabReplacement(details) {
  const preloadState = await loadPreloadState();

  if (
    isPreloadTab(preloadState, details.tabId) ||
    isPreloadTab(preloadState, details.replacedTabId)
  ) {
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-tab-replacement",
    replacedTabId: String(details.replacedTabId),
    newTabId: String(details.tabId),
  });

  await saveTrackingState(nextTrackingState);
}
