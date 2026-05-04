async function recordVisit(details, sourceEvent) {
  const normalizedVisitUrl = normalizePageUrlForIndex(details.url || "");

  if (!isTrackableAndAllowedUrl(details.url) || !normalizedVisitUrl) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.ignored", {
      reason: "untrackable-url",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId)) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.ignored", {
      reason: "preload-tab",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return;
  }

  const trackingState = await loadTrackingState();
  const tabId = String(details.tabId);
  const targetNode = buildNodeSeed(details.url);
  const pendingSource = trackingState.pendingSources?.[tabId] ?? null;
  const previousTabState = trackingState.tabState?.[String(details.tabId)] ?? null;
  const previousNodeId = pendingSource?.nodeId ?? previousTabState?.nodeId ?? null;
  const previousPageUrl =
    normalizePageUrlForIndex(pendingSource?.pageUrl || "") ??
    normalizePageUrlForIndex(previousTabState?.url || "");
  const pageInitiatedTransition = isPageInitiatedTransitionType(details.transitionType);

  if (!pageInitiatedTransition && !pendingSource) {
    const nextTrackingState = await applyTrackingEvent(trackingState, {
      type: "set-current-page",
      tabId,
      targetNode,
      occurredAt: toIsoTimestamp(details.timeStamp),
      url: normalizedVisitUrl,
    });

    await saveTrackingState(nextTrackingState);
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.saved", {
      tabId: details.tabId,
      sourceEvent,
      reason: "non-link-without-source-lock",
      transitionType: details.transitionType || "unknown",
      targetNodeId: targetNode.nodeId,
      targetPageUrl: normalizedVisitUrl,
    });
    return;
  }

  if (previousNodeId === targetNode.nodeId && previousPageUrl === normalizedVisitUrl) {
    if (trackingState.pendingSources?.[tabId]) {
      delete trackingState.pendingSources[tabId];
    }

    const nextTrackingState = await applyTrackingEvent(trackingState, {
      type: "set-current-page",
      tabId,
      targetNode,
      occurredAt: toIsoTimestamp(details.timeStamp),
      url: normalizedVisitUrl,
    });

    await saveTrackingState(nextTrackingState);
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.self-transition-skipped", {
      tabId: details.tabId,
      sourceEvent,
      transitionType: details.transitionType || "unknown",
      targetNodeId: targetNode.nodeId,
      targetPageUrl: normalizedVisitUrl,
    });
    return;
  }

  const previousTransitionSequence = clampNonNegativeInt(
    trackingState.graph?.transitionSequence,
    0
  );
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-visit",
    tabId,
    targetNode,
    occurredAt: toIsoTimestamp(details.timeStamp),
    eventType: sourceEvent,
    transitionType: details.transitionType || "unknown",
    url: normalizedVisitUrl,
  });

  await saveTrackingState(nextTrackingState);
  const nextTransitionSequence = clampNonNegativeInt(
    nextTrackingState.graph?.transitionSequence,
    0
  );
  const transitionRecorded = nextTransitionSequence > previousTransitionSequence;

  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.saved", {
    tabId: details.tabId,
    sourceEvent,
    transitionType: details.transitionType || "unknown",
    previousNodeId: previousTabState?.nodeId ?? null,
    previousPageUrl: previousTabState?.url || "",
    targetNodeId: targetNode.nodeId,
    targetPageUrl: normalizedVisitUrl,
    transitionRecorded,
    transitionSequence: transitionRecorded ? nextTransitionSequence : null,
  });
}

async function setCurrentPageFromVisit(details, sourceEvent) {
  const normalizedVisitUrl = normalizePageUrlForIndex(details.url || "");

  if (!isTrackableAndAllowedUrl(details.url) || !normalizedVisitUrl) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.ignored", {
      reason: "untrackable-url",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId)) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.ignored", {
      reason: "preload-tab",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "set-current-page",
    tabId: String(details.tabId),
    targetNode: buildNodeSeed(details.url),
    occurredAt: toIsoTimestamp(details.timeStamp),
    url: normalizedVisitUrl,
  });

  await saveTrackingState(nextTrackingState);
  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.saved", {
    tabId: details.tabId,
    sourceEvent,
    transitionType: details.transitionType || "unknown",
    targetNodeId: buildNodeSeed(details.url).nodeId,
    targetPageUrl: normalizedVisitUrl,
  });
}

async function recordCreatedNavigationTarget(details) {
  const preloadState = await loadPreloadState();

  if (
    isPreloadTab(preloadState, details.sourceTabId) ||
    isPreloadTab(preloadState, details.tabId)
  ) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.created-target.ignored", {
      reason: "preload-tab",
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      url: details.url || "",
    });
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
  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.created-target.saved", {
    sourceTabId: details.sourceTabId,
    tabId: details.tabId,
    url: details.url || "",
  });
}

async function recordTabReplacement(details) {
  const preloadState = await loadPreloadState();

  if (
    isPreloadTab(preloadState, details.tabId) ||
    isPreloadTab(preloadState, details.replacedTabId)
  ) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.tab-replacement.ignored", {
      reason: "preload-tab",
      tabId: details.tabId,
      replacedTabId: details.replacedTabId,
    });
    return;
  }

  const replacementTab = await getTabMaybe(details.tabId);
  const replacementUrl = normalizePageUrlForIndex(replacementTab?.url || "");
  const shouldRecordReplacementVisit =
    Boolean(replacementUrl) && isTrackableAndAllowedUrl(replacementTab?.url || "");
  const occurredAt = toIsoTimestampOrNow(details.timeStamp);
  const trackingState = await loadTrackingState();
  const previousTransitionSequence = clampNonNegativeInt(
    trackingState.graph?.transitionSequence,
    0
  );
  let nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-tab-replacement",
    replacedTabId: String(details.replacedTabId),
    newTabId: String(details.tabId),
  });

  if (shouldRecordReplacementVisit) {
    nextTrackingState = await applyTrackingEvent(nextTrackingState, {
      type: "record-visit",
      tabId: String(details.tabId),
      targetNode: buildNodeSeed(replacementTab.url),
      occurredAt,
      eventType: "tab-replaced",
      transitionType: "link",
      url: replacementUrl,
    });
  }

  await saveTrackingState(nextTrackingState);
  const nextTransitionSequence = clampNonNegativeInt(
    nextTrackingState.graph?.transitionSequence,
    0
  );
  const transitionRecorded = nextTransitionSequence > previousTransitionSequence;

  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.tab-replacement.saved", {
    tabId: details.tabId,
    replacedTabId: details.replacedTabId,
    replacementUrl,
    transitionRecorded,
    transitionSequence: transitionRecorded ? nextTransitionSequence : null,
  });
}

function toIsoTimestampOrNow(timeStamp) {
  return Number.isFinite(timeStamp) ? toIsoTimestamp(timeStamp) : new Date().toISOString();
}

function isPageInitiatedTransitionType(transitionType) {
  return transitionType === "link";
}
