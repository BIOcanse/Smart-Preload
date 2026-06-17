(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

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
      await globalThis.ZeroLatencyPreloadRuntimeManager.activateCreatedNavigationTarget?.(
        details
      );

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
      (await runtime.shouldSkipTrackingForExcludedSourceTab(
        details.sourceTabId,
        "created-navigation-source"
      )) ||
      (await runtime.shouldSkipTrackingForExcludedSourceTab(
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

  runtime.recordCreatedNavigationTarget = recordCreatedNavigationTarget;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
