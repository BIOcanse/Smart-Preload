(function () {
  async function run(_settings = getEffectiveExtensionSettings(), options = {}) {
    return getPreloadPerformanceWarningState({
      requireCachedAvailability: options.requireCachedAvailability !== false,
      timeoutMs: options.timeoutMs ?? 1000,
      forceRefresh: options.forceRefresh === true,
      allowRefresh: options.allowRefresh,
      maxCachedAgeMs: options.maxCachedAgeMs,
    });
  }

  globalThis.ZeroLatencyPreloadHeartbeatPerformanceWarningCheck = {
    run,
  };
})();
