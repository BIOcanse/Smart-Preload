const PRELOAD_PERFORMANCE_WARNING_CONSTANTS = Object.freeze({
  sampleWindowMs: 30000,
  highSampleMinCount: 3,
  memoryUsageRatio: 0.9,
  memoryAvailableBytes: 1536 * 1024 * 1024,
  vramUsageRatio: 0.9,
  vramAvailableBytes: 512 * 1024 * 1024,
  cpuUsagePercent: 90,
  gpuUsagePercent: 90,
});

globalThis.ZeroLatencyPreloadPerformanceWarningConstants =
  PRELOAD_PERFORMANCE_WARNING_CONSTANTS;
