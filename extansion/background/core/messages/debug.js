(function () {
  async function handleDebugSnapshot(message) {
    if (message?.mode === "popup") {
      return handlePopupDebugSnapshot(message);
    }

    if (message?.mode === "performance-warning") {
      return {
        performanceWarning: await resolvePreloadPerformanceWarning({
          allowRefresh: true,
          timeoutMs: 1000,
        }),
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
      performanceWarning: await resolvePreloadPerformanceWarning({
        allowRefresh: true,
        timeoutMs: 1000,
      }),
      currentPreloadWindowMonitor: resolveCurrentPreloadWindowMonitor(
        pageContext,
        hiddenWindowMonitor
      ),
    };
  }

  async function handlePopupDebugSnapshot(message) {
    const snapshot = await loadTrackingSnapshotForPopup();
    const pageContext = buildPageContext(
      { tabState: snapshot.tabState },
      snapshot.preloadState,
      message?.tabId,
      message?.pageUrl
    );

    return {
      summary: snapshot.summary,
      serviceState: snapshot.serviceState,
      pageContext,
      currentTopTargets: buildCurrentPreloads(snapshot.preloadState, message?.tabId),
      performanceWarning: await resolvePreloadPerformanceWarning({
        allowRefresh: false,
      }),
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
  };

  function resolveCurrentPreloadWindowMonitor(pageContext, hiddenWindowMonitor) {
    const trackedWindows = Array.isArray(hiddenWindowMonitor?.trackedWindows)
      ? hiddenWindowMonitor.trackedWindows
      : [];
    const targetHwnd = normalizePositiveFiniteNumber(pageContext?.preloadWindowHwnd);

    if (targetHwnd !== null) {
      return trackedWindows.find((windowInfo) => Number(windowInfo?.hwnd) === targetHwnd) ?? null;
    }

    return null;
  }

  async function resolvePreloadPerformanceWarning(options = {}) {
    const warningApi =
      globalThis.ZeroLatencyPreloadWindowPolicy?.getPreloadPerformanceWarningState;

    if (typeof warningApi !== "function") {
      return null;
    }

    try {
      return await warningApi(options);
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("debug.performance-warning.error", {
        error: String(error?.message || error),
      });
      return null;
    }
  }
})();
