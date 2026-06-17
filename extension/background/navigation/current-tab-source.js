(function () {
  async function lockCurrentTabNavigationSource(sourceTab, sourcePageUrl) {
    const normalizedSourcePageUrl = normalizePageUrlForIndex(
      sourcePageUrl || sourceTab?.url || ""
    );

    if (!sourceTab?.id || !normalizedSourcePageUrl) {
      return;
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return;
    }

    const trackingState = await loadTrackingState();
    const sourceTabId = String(sourceTab.id);
    const trackedSource = trackingState.tabState?.[sourceTabId] ?? null;
    const sourceNodeId =
      trackedSource?.nodeId ?? buildNodeSeed(normalizedSourcePageUrl).nodeId;
    const occurredAt = new Date().toISOString();

    trackingState.pendingSources[sourceTabId] = {
      nodeId: sourceNodeId,
      pageUrl: normalizedSourcePageUrl,
      createdAt: occurredAt,
    };

    await saveTrackingState(trackingState);
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-tab-source-lock.saved", {
      tabId: sourceTab.id,
      sourcePageUrl: normalizedSourcePageUrl,
      sourceNodeId,
    });
  }

  globalThis.ZeroLatencyNavigationCurrentTabSource = {
    lockCurrentTabNavigationSource,
  };
})();
