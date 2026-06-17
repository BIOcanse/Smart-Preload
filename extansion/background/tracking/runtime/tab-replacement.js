(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

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

  runtime.recordTabReplacement = recordTabReplacement;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
