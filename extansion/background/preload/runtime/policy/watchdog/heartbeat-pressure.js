async function collectPreloadWatchdogHeartbeatVerdicts(runtimeSettings) {
  if (typeof globalThis.ZeroLatencyPreloadHeartbeat?.collectVerdicts !== "function") {
    return null;
  }

  return globalThis.ZeroLatencyPreloadHeartbeat.collectVerdicts(runtimeSettings, {
    performanceWarning: {
      requireCachedAvailability: true,
      timeoutMs: 1000,
    },
  });
}

async function applyPreloadWatchdogResourcePressure(context, heartbeatVerdicts) {
  const pressureResult = await applyPreloadResourcePressurePolicy(
    context.preloadState,
    context.runtimeSettings,
    context.preloadWindowManager,
    {
      pressureState: heartbeatVerdicts?.resourcePressure?.state ?? null,
    }
  );

  if (pressureResult.handled && pressureResult.didMutate) {
    await savePreloadState(context.preloadState);
  }

  return pressureResult;
}

function refreshPreloadPerformanceWarningAfterHeartbeat(heartbeatVerdicts) {
  if (heartbeatVerdicts?.performanceWarning?.ok === true) {
    return;
  }

  void getPreloadPerformanceWarningState({
    requireCachedAvailability: true,
    timeoutMs: 1000,
  }).catch((error) => {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.performance-warning.refresh.error", {
      error: String(error?.message || error),
    });
  });
}
