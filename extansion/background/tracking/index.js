async function recordVisit(details, sourceEvent) {
  const normalizedVisitUrl = await resolveTrackableVisitUrl(details, sourceEvent, "tracking.visit");

  if (!normalizedVisitUrl) {
    return;
  }

  const context = await buildRecordVisitContext(details, normalizedVisitUrl);

  await recordBookmarkPreloadNavigationForVisit(context);

  if (!context.pageInitiatedTransition && !context.pendingSource) {
    await saveCurrentPageFromRecordVisitContext(
      context,
      sourceEvent,
      "non-link-without-source-lock"
    );
    return;
  }

  if (isSelfRecordVisitTransition(context)) {
    await skipSelfRecordVisitTransition(context, sourceEvent);
    return;
  }

  await saveRecordVisitTransition(context, sourceEvent);
}

async function resolveTrackableVisitUrl(details, sourceEvent, diagnosticPrefix) {
  const normalizedVisitUrl = normalizePageUrlForIndex(details.url || "");

  if (!isTrackableAndAllowedUrl(details.url) || !normalizedVisitUrl) {
    globalThis.ZeroLatencyDiagnostics?.record?.(`${diagnosticPrefix}.ignored`, {
      reason: "untrackable-url",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return null;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId)) {
    globalThis.ZeroLatencyDiagnostics?.record?.(`${diagnosticPrefix}.ignored`, {
      reason: "preload-tab",
      tabId: details.tabId,
      url: details.url || "",
      sourceEvent,
    });
    return null;
  }

  return normalizedVisitUrl;
}

async function buildRecordVisitContext(details, normalizedVisitUrl) {
  const trackingState = await loadTrackingState();
  const tabId = String(details.tabId);
  const targetNode = buildNodeSeed(details.url);
  const pendingSource = trackingState.pendingSources?.[tabId] ?? null;
  const previousTabState = trackingState.tabState?.[tabId] ?? null;
  const previousNodeId = pendingSource?.nodeId ?? previousTabState?.nodeId ?? null;
  const previousPageUrl =
    normalizePageUrlForIndex(pendingSource?.pageUrl || "") ??
    normalizePageUrlForIndex(previousTabState?.url || "");

  return {
    details,
    normalizedVisitUrl,
    trackingState,
    tabId,
    targetNode,
    pendingSource,
    previousTabState,
    previousNodeId,
    previousPageUrl,
    pageInitiatedTransition: isPageInitiatedTransitionType(details.transitionType),
  };
}

async function recordBookmarkPreloadNavigationForVisit(context) {
  await recordGoogleBookmarkPreloadNavigationIfNeeded(context.trackingState, {
    sourceTabId: context.details.tabId,
    sourceWindowId: null,
    sourcePageUrl: context.previousPageUrl || "",
    targetUrl: context.normalizedVisitUrl,
    transitionType: context.details.transitionType || "unknown",
    occurredAt: toIsoTimestamp(context.details.timeStamp),
    settings: getEffectiveExtensionSettings(),
  });
}

async function saveCurrentPageFromRecordVisitContext(context, sourceEvent, reason) {
  const nextTrackingState = await applyTrackingEvent(context.trackingState, {
    type: "set-current-page",
    tabId: context.tabId,
    targetNode: context.targetNode,
    occurredAt: toIsoTimestamp(context.details.timeStamp),
    url: context.normalizedVisitUrl,
  });

  await saveTrackingState(nextTrackingState);
  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.saved", {
    tabId: context.details.tabId,
    sourceEvent,
    reason,
    transitionType: context.details.transitionType || "unknown",
    targetNodeId: context.targetNode.nodeId,
    targetPageUrl: context.normalizedVisitUrl,
  });
}

function isSelfRecordVisitTransition(context) {
  return (
    context.previousNodeId === context.targetNode.nodeId &&
    context.previousPageUrl === context.normalizedVisitUrl
  );
}

async function skipSelfRecordVisitTransition(context, sourceEvent) {
  if (context.trackingState.pendingSources?.[context.tabId]) {
    delete context.trackingState.pendingSources[context.tabId];
  }

  const nextTrackingState = await applyTrackingEvent(context.trackingState, {
    type: "set-current-page",
    tabId: context.tabId,
    targetNode: context.targetNode,
    occurredAt: toIsoTimestamp(context.details.timeStamp),
    url: context.normalizedVisitUrl,
  });

  await saveTrackingState(nextTrackingState);
  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.self-transition-skipped", {
    tabId: context.details.tabId,
    sourceEvent,
    transitionType: context.details.transitionType || "unknown",
    targetNodeId: context.targetNode.nodeId,
    targetPageUrl: context.normalizedVisitUrl,
  });
}

async function saveRecordVisitTransition(context, sourceEvent) {
  const previousTransitionSequence = clampNonNegativeInt(
    context.trackingState.graph?.transitionSequence,
    0
  );
  const nextTrackingState = await applyTrackingEvent(context.trackingState, {
    type: "record-visit",
    tabId: context.tabId,
    targetNode: context.targetNode,
    occurredAt: toIsoTimestamp(context.details.timeStamp),
    eventType: sourceEvent,
    transitionType: context.details.transitionType || "unknown",
    url: context.normalizedVisitUrl,
  });

  await saveTrackingState(nextTrackingState);
  const nextTransitionSequence = clampNonNegativeInt(
    nextTrackingState.graph?.transitionSequence,
    0
  );
  const transitionRecorded = nextTransitionSequence > previousTransitionSequence;

  globalThis.ZeroLatencyDiagnostics?.record?.("tracking.visit.saved", {
    tabId: context.details.tabId,
    sourceEvent,
    transitionType: context.details.transitionType || "unknown",
    previousNodeId: context.previousTabState?.nodeId ?? null,
    previousPageUrl: context.previousTabState?.url || "",
    targetNodeId: context.targetNode.nodeId,
    targetPageUrl: context.normalizedVisitUrl,
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

  const activation =
    await globalThis.ZeroLatencyPreloadRuntimeManager.activateCreatedNavigationTarget?.(details);

  if (activation?.handled === true) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.created-target.preload-activated", {
      sourceTabId: details.sourceTabId,
      tabId: details.tabId,
      activatedTabId: activation.tabId ?? null,
      url: details.url || "",
    });
    return;
  }

  if (
    (await shouldSkipTrackingForExcludedSourceTab(
      details.sourceTabId,
      "created-navigation-source"
    )) ||
    (await shouldSkipTrackingForExcludedSourceTab(
      details.tabId,
      "created-navigation-target"
    ))
  ) {
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.created-target.ignored", {
      reason: "excluded-source",
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

async function shouldSkipTrackingForExcludedSourceTab(tabId, reason) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    return false;
  }

  const tab = await getTabMaybe(normalizedTabId);

  if (
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      tab,
      getEffectiveExtensionSettings()
    ) === true
  ) {
    globalThis.ZeroLatencyDebugEvents?.record?.("tracking.skip-incognito-source", {
      tabId: normalizedTabId,
      windowId: tab?.windowId ?? null,
      url: tab?.url || "",
      reason,
    });
    return true;
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
      tab,
      getEffectiveExtensionSettings()
    ) !== true
  ) {
    return false;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("tracking.skip-proxy-source", {
    tabId: normalizedTabId,
    windowId: tab?.windowId ?? null,
    url: tab?.url || "",
    reason,
  });
  return true;
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
