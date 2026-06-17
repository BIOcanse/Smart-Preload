const preloadPerformanceWarningPressureConstants =
  globalThis.ZeroLatencyPreloadPerformanceWarningConstants;

function evaluatePreloadPerformancePressure(metrics) {
  const memoryPressure =
    metrics.memoryUsageRatio >=
      preloadPerformanceWarningPressureConstants.memoryUsageRatio ||
    (metrics.availableMemoryBytes > 0 &&
      metrics.availableMemoryBytes <=
        preloadPerformanceWarningPressureConstants.memoryAvailableBytes);
  const vramPressure =
    metrics.gpuDedicatedMemory !== null &&
    (metrics.gpuDedicatedMemory.usageRatio >=
      preloadPerformanceWarningPressureConstants.vramUsageRatio ||
      (metrics.gpuDedicatedMemory.availableBytes > 0 &&
        metrics.gpuDedicatedMemory.availableBytes <=
          preloadPerformanceWarningPressureConstants.vramAvailableBytes));
  const cpuHigh =
    metrics.cpuUsagePercent >=
    preloadPerformanceWarningPressureConstants.cpuUsagePercent;
  const gpuHigh =
    metrics.gpuUsagePercent !== null &&
    metrics.gpuUsagePercent >=
      preloadPerformanceWarningPressureConstants.gpuUsagePercent;

  return {
    memoryPressure,
    vramPressure,
    cpuHigh,
    gpuHigh,
  };
}

function buildPreloadPerformancePressureReasons(pressure) {
  const reasons = [];

  if (pressure.memoryPressure) {
    reasons.push("memory");
  }

  if (pressure.vramPressure) {
    reasons.push("vram");
  }

  if (pressure.cpuPressure) {
    reasons.push("cpu");
  }

  if (pressure.gpuPressure) {
    reasons.push("gpu");
  }

  return reasons;
}

globalThis.ZeroLatencyPreloadPerformanceWarningPressure = {
  evaluatePreloadPerformancePressure,
  buildPreloadPerformancePressureReasons,
};
