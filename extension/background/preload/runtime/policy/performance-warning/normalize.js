function normalizePreloadActivitySnapshot(snapshot) {
  const gameProcessRunning =
    snapshot?.gameProcessRunning === true || snapshot?.game_process_running === true;
  const professionalProcessRunning =
    snapshot?.professionalProcessRunning === true ||
    snapshot?.professional_process_running === true;
  const nonChromeFullscreen =
    snapshot?.nonChromeFullscreen === true || snapshot?.non_chrome_fullscreen === true;

  return {
    gameProcessRunning,
    professionalProcessRunning,
    nonChromeFullscreen,
    externalWorkloadRunning:
      gameProcessRunning || professionalProcessRunning || nonChromeFullscreen,
  };
}

function normalizePreloadPerformanceMetrics(snapshot) {
  const system = snapshot?.system ?? {};
  const gpuDedicatedMemory =
    system.gpuDedicatedMemory ?? system.gpu_dedicated_memory ?? null;
  const gpuDedicatedMemoryMetrics = gpuDedicatedMemory
    ? {
        usedBytes: normalizePreloadMetricNumber(
          gpuDedicatedMemory.usedBytes ?? gpuDedicatedMemory.used_bytes
        ),
        limitBytes: normalizePreloadMetricNumber(
          gpuDedicatedMemory.limitBytes ?? gpuDedicatedMemory.limit_bytes
        ),
        availableBytes: normalizePreloadMetricNumber(
          gpuDedicatedMemory.availableBytes ?? gpuDedicatedMemory.available_bytes
        ),
        usageRatio: normalizePreloadMetricNumber(
          gpuDedicatedMemory.usageRatio ?? gpuDedicatedMemory.usage_ratio
        ),
      }
    : null;

  return {
    cpuUsagePercent: normalizePreloadMetricNumber(
      system.cpuUsagePercent ?? system.cpu_usage_percent
    ),
    memoryUsageRatio: normalizePreloadMetricNumber(
      system.memoryUsageRatio ?? system.memory_usage_ratio
    ),
    availableMemoryBytes: normalizePreloadMetricNumber(
      system.availableMemoryBytes ?? system.available_memory_bytes
    ),
    totalMemoryBytes: normalizePreloadMetricNumber(
      system.totalMemoryBytes ?? system.total_memory_bytes
    ),
    gpuUsagePercent: normalizeNullablePreloadMetricNumber(
      system.gpuUsagePercent ?? system.gpu_usage_percent
    ),
    gpuDedicatedMemory:
      gpuDedicatedMemoryMetrics && gpuDedicatedMemoryMetrics.limitBytes > 0
        ? gpuDedicatedMemoryMetrics
        : null,
  };
}

function normalizePreloadMetricNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeNullablePreloadMetricNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

globalThis.ZeroLatencyPreloadPerformanceWarningNormalize = {
  normalizePreloadActivitySnapshot,
  normalizePreloadPerformanceMetrics,
  normalizePreloadMetricNumber,
  normalizeNullablePreloadMetricNumber,
};
