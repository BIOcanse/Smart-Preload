(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

  async function setCurrentPageFromVisit(details, sourceEvent) {
    const normalizedVisitUrl = await runtime.resolveTrackableVisitUrl(
      details,
      sourceEvent,
      "tracking.current-page"
    );

    if (!normalizedVisitUrl) {
      return;
    }

    const trackingState = await loadTrackingState();
    const targetNode = buildNodeSeed(details.url);
    const nextTrackingState = await applyTrackingEvent(trackingState, {
      type: "set-current-page",
      tabId: String(details.tabId),
      targetNode,
      occurredAt: toIsoTimestamp(details.timeStamp),
      url: normalizedVisitUrl,
    });

    await saveTrackingState(nextTrackingState);
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-page.saved", {
      tabId: details.tabId,
      sourceEvent,
      transitionType: details.transitionType || "unknown",
      targetNodeId: targetNode.nodeId,
      targetPageUrl: normalizedVisitUrl,
    });
  }

  runtime.setCurrentPageFromVisit = setCurrentPageFromVisit;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
