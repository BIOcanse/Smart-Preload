const preloadPerformanceWarningStateConstants =
  globalThis.ZeroLatencyPreloadPerformanceWarningConstants;
const preloadPerformanceWarningNormalize =
  globalThis.ZeroLatencyPreloadPerformanceWarningNormalize;
const preloadPerformanceWarningPressure =
  globalThis.ZeroLatencyPreloadPerformanceWarningPressure;
const preloadPerformanceWarningSampleStore =
  globalThis.ZeroLatencyPreloadPerformanceWarningSamples;

function buildPreloadPerformanceWarningState(
  activitySnapshot,
  performanceSnapshot,
  now = Date.now()
) {
  const queriedAt = new Date(now).toISOString();

  if (!performanceSnapshot?.system) {
    return createInactivePreloadPerformanceWarningState(
      performanceSnapshot ? "system-performance-unavailable" : "performance-unavailable",
      now,
      {
        activitySnapshot,
        performanceSnapshot,
      }
    );
  }

  const activity =
    preloadPerformanceWarningNormalize.normalizePreloadActivitySnapshot(
      activitySnapshot
    );
  const metrics =
    preloadPerformanceWarningNormalize.normalizePreloadPerformanceMetrics(
      performanceSnapshot
    );
  const instantPressure =
    preloadPerformanceWarningPressure.evaluatePreloadPerformancePressure(metrics);
  const samplePressure =
    preloadPerformanceWarningSampleStore.updatePreloadPerformanceWarningSamples(
      activity,
      instantPressure,
      now
    );
  const reasons = preloadPerformanceWarningPressure.buildPreloadPerformancePressureReasons({
    ...instantPressure,
    ...samplePressure,
  });
  const active = activity.externalWorkloadRunning !== true && reasons.length > 0;

  return {
    active,
    reason: active
      ? "performance-insufficient"
      : activity.externalWorkloadRunning
        ? "external-workload"
        : "none",
    reasons: active ? reasons : [],
    suppressedReasons: active ? [] : reasons,
    messageKey: "performanceInsufficientReducePreloadCaps",
    externalWorkloadRunning: activity.externalWorkloadRunning,
    gameProcessRunning: activity.gameProcessRunning,
    professionalProcessRunning: activity.professionalProcessRunning,
    nonChromeFullscreen: activity.nonChromeFullscreen,
    activitySnapshot,
    performanceSnapshot,
    metrics: {
      ...metrics,
      cpuHighSampleCount: samplePressure.cpuHighSampleCount,
      gpuHighSampleCount: samplePressure.gpuHighSampleCount,
      sampleWindowSeconds: samplePressure.sampleWindowSeconds,
    },
    queriedAt,
  };
}

function createInactivePreloadPerformanceWarningState(
  reason,
  now = Date.now(),
  extra = {}
) {
  return {
    active: false,
    reason,
    reasons: [],
    suppressedReasons: [],
    messageKey: "performanceInsufficientReducePreloadCaps",
    externalWorkloadRunning: false,
    gameProcessRunning: false,
    professionalProcessRunning: false,
    nonChromeFullscreen: false,
    metrics: {
      cpuUsagePercent: 0,
      memoryUsageRatio: 0,
      availableMemoryBytes: 0,
      totalMemoryBytes: 0,
      gpuUsagePercent: null,
      gpuDedicatedMemory: null,
      cpuHighSampleCount: 0,
      gpuHighSampleCount: 0,
      sampleWindowSeconds:
        preloadPerformanceWarningStateConstants.sampleWindowMs / 1000,
    },
    queriedAt: new Date(now).toISOString(),
    ...extra,
  };
}

globalThis.ZeroLatencyPreloadPerformanceWarningState = {
  buildPreloadPerformanceWarningState,
  normalizePreloadActivitySnapshot:
    preloadPerformanceWarningNormalize.normalizePreloadActivitySnapshot,
  normalizePreloadPerformanceMetrics:
    preloadPerformanceWarningNormalize.normalizePreloadPerformanceMetrics,
  createInactivePreloadPerformanceWarningState,
};
