(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

  async function recordVisit(details, sourceEvent) {
    const normalizedVisitUrl = await runtime.resolveTrackableVisitUrl(
      details,
      sourceEvent,
      "tracking.visit"
    );

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

  function isPageInitiatedTransitionType(transitionType) {
    return transitionType === "link";
  }

  runtime.recordVisit = recordVisit;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
