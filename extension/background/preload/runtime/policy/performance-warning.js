const PRELOAD_PERFORMANCE_WARNING_CACHE_MS = 5000;
const PRELOAD_PERFORMANCE_WARNING_STALE_CACHE_MS = 30000;
let preloadPerformanceWarningCache = null;
const preloadPerformanceWarningStateModel =
  globalThis.ZeroLatencyPreloadPerformanceWarningState;

async function getPreloadPerformanceWarningState(options = {}) {
  const now = Date.now();

  if (options.allowRefresh === false) {
    if (
      preloadPerformanceWarningCache &&
      now - preloadPerformanceWarningCache.queriedAtMs <=
        (options.maxCachedAgeMs ?? PRELOAD_PERFORMANCE_WARNING_STALE_CACHE_MS)
    ) {
      return preloadPerformanceWarningCache.state;
    }

    return preloadPerformanceWarningStateModel.createInactivePreloadPerformanceWarningState(
      "cache-unavailable",
      now
    );
  }

  if (
    options.forceRefresh !== true &&
    preloadPerformanceWarningCache &&
    now - preloadPerformanceWarningCache.queriedAtMs < PRELOAD_PERFORMANCE_WARNING_CACHE_MS
  ) {
    return preloadPerformanceWarningCache.state;
  }

  const [activitySnapshot, performanceSnapshot] = await Promise.all([
    typeof nativeAppGetSystemActivitySnapshot === "function"
      ? nativeAppGetSystemActivitySnapshot({
          timeoutMs: options.timeoutMs ?? 1000,
          requireCachedAvailability: options.requireCachedAvailability !== false,
        })
      : null,
    typeof nativeAppGetSystemPerformanceSnapshot === "function"
      ? nativeAppGetSystemPerformanceSnapshot({
          timeoutMs: options.timeoutMs ?? 1000,
          requireCachedAvailability: options.requireCachedAvailability !== false,
        })
      : null,
  ]);
  const state = preloadPerformanceWarningStateModel.buildPreloadPerformanceWarningState(
    activitySnapshot,
    performanceSnapshot,
    now
  );

  preloadPerformanceWarningCache = {
    queriedAtMs: now,
    state,
  };

  globalThis.ZeroLatencyDebugEvents?.record?.("preload.performance-warning.state", {
    active: state.active,
    reason: state.reason,
    reasons: state.reasons,
    externalWorkloadRunning: state.externalWorkloadRunning,
    metrics: state.metrics,
  });

  return state;
}
