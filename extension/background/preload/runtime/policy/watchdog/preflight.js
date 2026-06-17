async function resolvePreloadWatchdogRunContext() {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return {
      shouldRun: false,
      reason: "unsupported-hidden-tab-runtime",
    };
  }

  const runtimeSettings = getEffectiveExtensionSettings();

  if ((await isExtensionServicePaused()) || !runtimeSettings.preloading.enabled) {
    return {
      shouldRun: false,
      reason: "paused-or-disabled",
      runtimeSettings,
    };
  }

  return {
    shouldRun: true,
    runtimeSettings,
    preloadState: await loadPreloadState(),
    preloadWindowManager: globalThis.ZeroLatencyPreloadWindowManager,
  };
}

async function applyPreloadWatchdogNativeOnlyModeCleanup(context) {
  const { preloadState, runtimeSettings } = context || {};

  if (
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      runtimeSettings
    ) !== true
  ) {
    return {
      handled: false,
      didMutate: false,
    };
  }

  const cleanup =
    await globalThis.ZeroLatencyPreloadNativeOnlyPolicy.clearHiddenTabPreloadStateForNativeOnlyMode(
      preloadState,
      runtimeSettings,
      {
        reason: "watchdog",
      }
    );

  if (cleanup.mutated) {
    await savePreloadState(cleanup.preloadState);
  }

  return {
    handled: true,
    didMutate: cleanup.mutated === true,
  };
}
