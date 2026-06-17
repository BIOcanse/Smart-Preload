function buildRealPreloadRecommendationWarning(
  settings = resolveCurrentNativeOnlySettings(),
  performanceWarning = null
) {
  if (
    settings?.preloading?.enabled !== true ||
    isRealPreloadEnabled(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() !== true
  ) {
    return {
      active: false,
    };
  }

  const totalMemoryBytes = extractTotalMemoryBytesFromPerformanceWarning(performanceWarning);

  if (totalMemoryBytes <= 0) {
    return {
      active: false,
      reason: "real-preload-memory-unavailable",
    };
  }

  const lowMemory =
    totalMemoryBytes < REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES;

  return {
    active: true,
    reason: lowMemory ? "real-preload-low-memory" : "real-preload-recommended",
    messageKey: lowMemory
      ? "realPreloadAvailableLowMemoryWarning"
      : "realPreloadRecommendedWarning",
    messageFallback: lowMemory
      ? REAL_PRELOAD_LOW_MEMORY_RECOMMENDATION_FALLBACK
      : REAL_PRELOAD_RECOMMENDED_FALLBACK,
    totalMemoryBytes,
    thresholdMemoryBytes: REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES,
  };
}

function extractTotalMemoryBytesFromPerformanceWarning(performanceWarning) {
  const value =
    performanceWarning?.metrics?.totalMemoryBytes ??
    performanceWarning?.performanceSnapshot?.system?.totalMemoryBytes ??
    performanceWarning?.performanceSnapshot?.system?.total_memory_bytes ??
    0;
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}
