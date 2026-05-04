(function () {
  async function handleDebugSnapshot(message) {
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
      currentPreloadWindowMonitor: resolveCurrentPreloadWindowMonitor(
        pageContext,
        hiddenWindowMonitor
      ),
    };
  }

  async function handleReset() {
    await resetPreloads();
    await chrome.storage.local.set({
      [GRAPH_KEY]: createEmptyGraph(),
      [TAB_STATE_KEY]: {},
      [PENDING_SOURCE_KEY]: {},
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
})();
