const preloadPerformanceWarningSampleConstants =
  globalThis.ZeroLatencyPreloadPerformanceWarningConstants;
const preloadPerformanceWarningSamples = [];

function updatePreloadPerformanceWarningSamples(
  activity,
  pressureInput,
  now = Date.now()
) {
  if (activity.externalWorkloadRunning !== true) {
    preloadPerformanceWarningSamples.push({
      atMs: now,
      cpuHigh: pressureInput.cpuHigh,
      gpuHigh: pressureInput.gpuHigh,
    });
  }

  prunePreloadPerformanceWarningSamples(now);

  const cpuHighSampleCount = preloadPerformanceWarningSamples.filter(
    (sample) => sample.cpuHigh
  ).length;
  const gpuHighSampleCount = preloadPerformanceWarningSamples.filter(
    (sample) => sample.gpuHigh
  ).length;

  return {
    cpuHighSampleCount,
    gpuHighSampleCount,
    cpuPressure:
      cpuHighSampleCount >= preloadPerformanceWarningSampleConstants.highSampleMinCount,
    gpuPressure:
      gpuHighSampleCount >= preloadPerformanceWarningSampleConstants.highSampleMinCount,
    sampleWindowSeconds:
      preloadPerformanceWarningSampleConstants.sampleWindowMs / 1000,
  };
}

function prunePreloadPerformanceWarningSamples(now = Date.now()) {
  const oldestAllowedAt =
    now - preloadPerformanceWarningSampleConstants.sampleWindowMs;

  while (
    preloadPerformanceWarningSamples.length > 0 &&
    preloadPerformanceWarningSamples[0].atMs < oldestAllowedAt
  ) {
    preloadPerformanceWarningSamples.shift();
  }
}

globalThis.ZeroLatencyPreloadPerformanceWarningSamples = {
  updatePreloadPerformanceWarningSamples,
  prunePreloadPerformanceWarningSamples,
};
