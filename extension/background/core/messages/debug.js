(function () {
  async function handleDebugSnapshot(message) {
    if (message?.mode === "popup") {
      return handlePopupDebugSnapshot(message);
    }

    if (message?.mode === "performance-warning") {
      const performanceWarning = await resolvePreloadPerformanceWarning({
        allowRefresh: true,
        timeoutMs: 1000,
      });
      const nativeAppModeWarning = await resolveNativeAppModeWarning({
        allowStorage: true,
      });

      return {
        performanceWarning,
        nativeAppModeWarning,
        realPreloadRecommendationWarning: resolveRealPreloadRecommendationWarning(
          performanceWarning
        ),
        mode: "performance-warning",
      };
    }

    const trackingState = await loadTrackingState();
    const preloadState = await loadPreloadState();
    const serviceState = await loadServiceState();
    const pageContext = buildPageContext(
      trackingState,
      preloadState,
      message?.tabId,
      message?.pageUrl
    );
    const hiddenWindowMonitor =
      serviceState.paused !== true &&
      typeof globalThis.nativeAppGetHiddenWindowMonitor === "function"
        ? await globalThis.nativeAppGetHiddenWindowMonitor()
        : null;

    const performanceWarning = await resolvePreloadPerformanceWarning({
      allowRefresh: true,
      timeoutMs: 1000,
    });
    const nativeAppModeWarning = await resolveNativeAppModeWarning({
      allowStorage: true,
    });

    return {
      summary: buildDebugSnapshot(trackingState.graph),
      serviceState,
      pageContext,
      currentTopTargets: buildCurrentPreloads(preloadState, message?.tabId),
      recentRuntimeEvents: globalThis.ZeroLatencyDebugEvents?.snapshot?.(128) ?? [],
      diagnostics: globalThis.ZeroLatencyDiagnostics?.getStatus?.() ?? null,
      knownPreloadRuntime: globalThis.snapshotKnownPreloadRuntime?.() ?? null,
      featureSupport: globalThis.ZeroLatencySupport?.getBackgroundFeatureSupport?.() ?? {},
      hiddenWindowMonitor,
      performanceWarning,
      nativeAppModeWarning,
      realPreloadRecommendationWarning: resolveRealPreloadRecommendationWarning(
        performanceWarning
      ),
      currentPreloadWindowMonitor: resolveCurrentPreloadWindowMonitor(
        pageContext,
        hiddenWindowMonitor
      ),
    };
  }

  async function handlePopupDebugSnapshot(message) {
    await globalThis.whenBackgroundStateReady?.();
    const snapshot = await loadTrackingSnapshotForPopup();
    const pageContext = buildPageContext(
      { tabState: snapshot.tabState },
      snapshot.preloadState,
      message?.tabId,
      message?.pageUrl
    );

    const performanceWarning = await resolvePreloadPerformanceWarning({
      allowRefresh: false,
    });
    const nativeAppModeWarning = await resolveNativeAppModeWarning({
      allowStorage: false,
    });

    return {
      summary: snapshot.summary,
      serviceState: snapshot.serviceState,
      pageContext,
      currentTopTargets: buildCurrentPreloads(snapshot.preloadState, message?.tabId),
      performanceWarning,
      nativeAppModeWarning,
      realPreloadRecommendationWarning: resolveRealPreloadRecommendationWarning(
        performanceWarning
      ),
      mode: "popup",
    };
  }

  async function handleReset() {
    await resetPreloads();
    await saveTrackingState({
      graph: createEmptyGraph(),
      tabState: {},
      pendingSources: {},
    });
    globalThis.ZeroLatencyDebugEvents?.clear?.();

    return { ok: true };
  }

  globalThis.ZeroLatencyCoreDebugMessages = {
    handleDebugSnapshot,
    handleReset,
    handleDeleteHistoryRange,
  };
})();
