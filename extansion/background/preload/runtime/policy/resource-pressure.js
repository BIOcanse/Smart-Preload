const PRELOAD_RESOURCE_PRESSURE_ACTIVITY_CACHE_MS = 1500;
let preloadResourcePressureActivityCache = null;

function resolvePreloadFullscreenPressurePolicy(settings = getEffectiveExtensionSettings()) {
  const settingsApi = globalThis.ZeroLatencySettings;

  if (typeof settingsApi?.normalizeFullscreenPressurePolicy === "function") {
    return settingsApi.normalizeFullscreenPressurePolicy(
      settings?.preloadWindow?.fullscreenPressurePolicy
    );
  }

  const value = settings?.preloadWindow?.fullscreenPressurePolicy;
  return ["close", "sleep", "ignore"].includes(value) ? value : "sleep";
}

async function getPreloadResourcePressureState(settings = getEffectiveExtensionSettings(), options = {}) {
  const policy = resolvePreloadFullscreenPressurePolicy(settings);

  if (policy === "ignore") {
    return {
      active: false,
      shouldDeferHiddenTabs: false,
      policy,
      reason: "policy-ignore",
      snapshot: null,
      queriedAt: new Date().toISOString(),
    };
  }

  const now = Date.now();

  if (
    options.forceRefresh !== true &&
    preloadResourcePressureActivityCache &&
    preloadResourcePressureActivityCache.policy === policy &&
    now - preloadResourcePressureActivityCache.queriedAtMs <
      PRELOAD_RESOURCE_PRESSURE_ACTIVITY_CACHE_MS
  ) {
    return preloadResourcePressureActivityCache.state;
  }

  const snapshot =
    typeof nativeAppGetSystemActivitySnapshot === "function"
      ? await nativeAppGetSystemActivitySnapshot({
          timeoutMs: options.timeoutMs ?? 1500,
        })
      : null;
  const nonChromeFullscreen =
    snapshot?.nonChromeFullscreen === true || snapshot?.non_chrome_fullscreen === true;
  const gameProcessRunning =
    snapshot?.gameProcessRunning === true || snapshot?.game_process_running === true;
  const active = nonChromeFullscreen || gameProcessRunning;
  const reason = nonChromeFullscreen
    ? "non-chrome-fullscreen"
    : gameProcessRunning
      ? "game-process"
      : snapshot
        ? "none"
        : "activity-unavailable";
  const state = {
    active,
    shouldDeferHiddenTabs: active && policy !== "ignore",
    policy,
    reason,
    snapshot,
    queriedAt: new Date(now).toISOString(),
  };

  preloadResourcePressureActivityCache = {
    policy,
    queriedAtMs: now,
    state,
  };

  globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.state", {
    active: state.active,
    policy: state.policy,
    reason: state.reason,
    foregroundProcess: snapshot?.foreground?.processName ?? null,
    gameProcess: snapshot?.gameProcess?.processName ?? null,
  });

  return state;
}

async function shouldDeferHiddenTabPreloadsForResourcePressure(
  settings = getEffectiveExtensionSettings(),
  options = {}
) {
  const pressureState = await getPreloadResourcePressureState(settings, options);
  return pressureState.shouldDeferHiddenTabs === true;
}

async function applyPreloadResourcePressurePolicy(
  preloadState,
  settings = getEffectiveExtensionSettings(),
  preloadWindowManager = globalThis.ZeroLatencyPreloadWindowManager,
  options = {}
) {
  const pressureState =
    options.pressureState ?? (await getPreloadResourcePressureState(settings));

  if (pressureState.shouldDeferHiddenTabs !== true) {
    return {
      handled: false,
      didMutate: false,
      pressureState,
    };
  }

  let didMutate = false;

  for (const [normalWindowId, normalWindowRuntime] of Object.entries(
    preloadState.normalWindowsById || {}
  )) {
    if (!normalWindowRuntime) {
      continue;
    }

    if (pressureState.policy === "close") {
      didMutate =
        (await closeHiddenTabsForResourcePressure(
          preloadState,
          normalWindowId,
          normalWindowRuntime,
          preloadWindowManager
        )) || didMutate;
      continue;
    }

    if (pressureState.policy === "sleep") {
      didMutate =
        (await sleepHiddenTabsForResourcePressure(
          preloadState,
          normalWindowId,
          normalWindowRuntime,
          preloadWindowManager
        )) || didMutate;
    }
  }

  return {
    handled: true,
    didMutate,
    pressureState,
  };
}
