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

  async function handleDeleteHistoryRange(message) {
    const trackingState = await loadTrackingState();
    const deletion = globalThis.ZeroLatencyTrackingHistoryDeletion.deleteTrackingHistoryRange(
      trackingState,
      message?.range ?? message
    );

    await saveTrackingState(deletion.state);
    globalThis.ZeroLatencyDebugEvents?.record?.("tracking.history.delete-range", {
      range: deletion.result.range,
      deleted: deletion.result.deleted,
      after: deletion.result.after,
    });

    return deletion.result;
  }

  globalThis.ZeroLatencyCoreDebugMessages = {
    handleDebugSnapshot,
    handleReset,
    handleDeleteHistoryRange,
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

  async function resolveNativeAppModeWarning(options = {}) {
    try {
      const settings =
        typeof getEffectiveExtensionSettings === "function"
          ? getEffectiveExtensionSettings()
          : null;
      const policyApi = globalThis.ZeroLatencyPreloadNativeOnlyPolicy;

      if (
        options.allowStorage === false &&
        typeof policyApi?.peekNativeAppModeWarning === "function"
      ) {
        return policyApi.peekNativeAppModeWarning(settings);
      }

      return (await policyApi?.buildNativeAppModeWarning?.(settings)) ?? null;
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("debug.native-app-mode-warning.error", {
        error: String(error?.message || error),
      });
      return null;
    }
  }

  function resolveRealPreloadRecommendationWarning(performanceWarning) {
    try {
      const settings =
        typeof getEffectiveExtensionSettings === "function"
          ? getEffectiveExtensionSettings()
          : null;
      return (
        globalThis.ZeroLatencyPreloadNativeOnlyPolicy
          ?.buildRealPreloadRecommendationWarning?.(settings, performanceWarning) ?? null
      );
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("debug.real-preload-warning.error", {
        error: String(error?.message || error),
      });
      return null;
    }
  }
})();
