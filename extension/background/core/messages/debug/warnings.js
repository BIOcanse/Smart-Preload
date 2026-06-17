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
