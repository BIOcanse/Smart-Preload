const PRELOAD_RESOURCE_PRESSURE_ACTIVITY_CACHE_MS = 1500;
const PRELOAD_PERFORMANCE_WARNING_CACHE_MS = 5000;
const PRELOAD_PERFORMANCE_WARNING_STALE_CACHE_MS = 30000;
const PRELOAD_PERFORMANCE_WARNING_SAMPLE_WINDOW_MS = 30000;
const PRELOAD_PERFORMANCE_WARNING_HIGH_SAMPLE_MIN_COUNT = 3;
const PRELOAD_PERFORMANCE_WARNING_MEMORY_RATIO = 0.9;
const PRELOAD_PERFORMANCE_WARNING_MEMORY_AVAILABLE_BYTES = 1536 * 1024 * 1024;
const PRELOAD_PERFORMANCE_WARNING_VRAM_RATIO = 0.9;
const PRELOAD_PERFORMANCE_WARNING_VRAM_AVAILABLE_BYTES = 512 * 1024 * 1024;
const PRELOAD_PERFORMANCE_WARNING_CPU_PERCENT = 90;
const PRELOAD_PERFORMANCE_WARNING_GPU_PERCENT = 90;
let preloadResourcePressureActivityCache = null;
let preloadPerformanceWarningCache = null;
const preloadPerformanceWarningSamples = [];

async function enforcePreloadWindowPolicy() {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  const runtimeSettings = getEffectiveExtensionSettings();

  if ((await isExtensionServicePaused()) || !runtimeSettings.preloading.enabled) {
    return;
  }

  const preloadState = await loadPreloadState();
  let didMutate = false;
  const preloadWindowManager = globalThis.ZeroLatencyPreloadWindowManager;
  if (
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      runtimeSettings
    ) === true
  ) {
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
    return;
  }

  const pressureResult = await applyPreloadResourcePressurePolicy(
    preloadState,
    runtimeSettings,
    preloadWindowManager
  );
  void getPreloadPerformanceWarningState({
    requireCachedAvailability: true,
    timeoutMs: 1000,
  }).catch((error) => {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.performance-warning.refresh.error", {
      error: String(error?.message || error),
    });
  });

  if (pressureResult.handled) {
    if (pressureResult.didMutate) {
      await savePreloadState(preloadState);
    }
    return;
  }

  if (runtimeSettings.preloadWindow.watchdogEnabled !== true) {
    return;
  }

  for (const normalWindowId of Object.keys(preloadState.normalWindowsById || {})) {
    const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

    if (!normalWindowRuntime) {
      continue;
    }

    const liveNormalWindow = await getWindowMaybe(Number(normalWindowId));

    if (liveNormalWindow?.type !== "normal") {
      if (await preloadWindowManager.closeWindowForNormalWindow(preloadState, normalWindowId)) {
        didMutate = true;
      }

      pruneNormalWindowRuntime(preloadState, normalWindowId);
      didMutate = true;
      continue;
    }

    if (!hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime)) {
      const keepWarmPreloadWindow = shouldKeepWarmPreloadWindow(normalWindowRuntime);

      if (keepWarmPreloadWindow) {
        const ensuredWindow = await preloadWindowManager.ensureWindow(preloadState, normalWindowId);

        if (ensuredWindow.created) {
          didMutate = true;
        }

        const previousHiddenBySystem =
          normalWindowRuntime.preloadWindow.hiddenBySystem === true;
        const previousHwnd = normalWindowRuntime.preloadWindow.hwnd ?? null;
        const previousSystemHideSignature = getPreloadWindowSystemHideSignature(
          normalWindowRuntime.preloadWindow
        );
        await preloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
          hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
          hwnd: normalWindowRuntime.preloadWindow.hwnd,
          normalWindowRuntime,
          trigger: "watchdog-warm-window",
        });
        didMutate =
          didMutate ||
          previousHiddenBySystem !==
            (normalWindowRuntime.preloadWindow.hiddenBySystem === true) ||
          previousHwnd !== (normalWindowRuntime.preloadWindow.hwnd ?? null) ||
          previousSystemHideSignature !==
            getPreloadWindowSystemHideSignature(normalWindowRuntime.preloadWindow);
        continue;
      }

      if (await preloadWindowManager.closeWindowForNormalWindow(preloadState, normalWindowId)) {
        didMutate = true;
      }

      pruneNormalWindowRuntime(preloadState, normalWindowId);
      continue;
    }

    const ensuredWindow = await preloadWindowManager.ensureWindow(preloadState, normalWindowId);

    if (ensuredWindow.created) {
      didMutate = true;
    }

    const didRepairEntries = await preloadWindowManager.repairEntriesForWindow(
      preloadState,
      Number(normalWindowId),
      ensuredWindow.windowId
    );

    const isHiddenBySystem = normalWindowRuntime.preloadWindow.hiddenBySystem === true;

    const previousHiddenBySystem =
      normalWindowRuntime.preloadWindow.hiddenBySystem === true;
    const previousHwnd = normalWindowRuntime.preloadWindow.hwnd ?? null;
    const previousSystemHideSignature = getPreloadWindowSystemHideSignature(
      normalWindowRuntime.preloadWindow
    );
    await preloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
      hiddenBySystem: isHiddenBySystem,
      hwnd: normalWindowRuntime.preloadWindow.hwnd,
      normalWindowRuntime,
      trigger: "watchdog-preload-window",
    });
    didMutate =
      didMutate ||
      previousHiddenBySystem !==
        (normalWindowRuntime.preloadWindow.hiddenBySystem === true) ||
      previousHwnd !== (normalWindowRuntime.preloadWindow.hwnd ?? null) ||
      previousSystemHideSignature !==
        getPreloadWindowSystemHideSignature(normalWindowRuntime.preloadWindow);

    if (didRepairEntries) {
      didMutate = true;
    }
  }

  if (await preloadWindowManager.cleanupErroneousWindows(preloadState)) {
    didMutate = true;
  }

  if (didMutate) {
    await savePreloadState(preloadState);
  }
}

async function ensurePreloadWindowWatchdog() {
  const supportApi = globalThis.ZeroLatencySupport;
  const watchdogSupported = supportApi?.supportsPreloadWindowWatchdog?.() === true;
  const runtimeSettings = getEffectiveExtensionSettings();
  const servicePaused = await isExtensionServicePaused();
  const pressurePolicy = resolvePreloadFullscreenPressurePolicy(runtimeSettings);
  const shouldRunWatchdog =
    !servicePaused &&
    runtimeSettings.preloading.enabled &&
    watchdogSupported &&
    (runtimeSettings.preloadWindow.watchdogEnabled || pressurePolicy !== "ignore");

  if (!shouldRunWatchdog) {
    if (supportApi?.hasChromeNamespaceMethod?.("alarms", "clear") === true) {
      await chrome.alarms.clear(PRELOAD_WINDOW_WATCHDOG_ALARM);
      await chrome.alarms.clear(PRELOAD_WINDOW_CLEANUP_ALARM);
    }
    return;
  }

  const periodInMinutes = runtimeSettings.preloadWindow.watchdogIntervalSeconds / 60;
  const cleanupPeriodInMinutes = 1 / 60;

  await chrome.alarms.create(PRELOAD_WINDOW_WATCHDOG_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });

  await chrome.alarms.create(PRELOAD_WINDOW_CLEANUP_ALARM, {
    delayInMinutes: cleanupPeriodInMinutes,
    periodInMinutes: cleanupPeriodInMinutes,
  });
}

function shouldKeepWarmPreloadWindow(normalWindowRuntime) {
  if (globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() !== true) {
    return false;
  }

  return !isPreloadWindowSystemHideBackoffActive(normalWindowRuntime?.preloadWindow);
}

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

async function getPreloadPerformanceWarningState(options = {}) {
  const now = Date.now();

  if (options.allowRefresh === false) {
    if (
      preloadPerformanceWarningCache &&
      now - preloadPerformanceWarningCache.queriedAtMs <=
        (options.maxCachedAgeMs ?? PRELOAD_PERFORMANCE_WARNING_STALE_CACHE_MS)
    ) {
      return preloadPerformanceWarningCache.state;
    }

    return createInactivePreloadPerformanceWarningState("cache-unavailable", now);
  }

  if (
    options.forceRefresh !== true &&
    preloadPerformanceWarningCache &&
    now - preloadPerformanceWarningCache.queriedAtMs < PRELOAD_PERFORMANCE_WARNING_CACHE_MS
  ) {
    return preloadPerformanceWarningCache.state;
  }

  const [activitySnapshot, performanceSnapshot] = await Promise.all([
    typeof nativeAppGetSystemActivitySnapshot === "function"
      ? nativeAppGetSystemActivitySnapshot({
          timeoutMs: options.timeoutMs ?? 1000,
          requireCachedAvailability: options.requireCachedAvailability !== false,
        })
      : null,
    typeof nativeAppGetSystemPerformanceSnapshot === "function"
      ? nativeAppGetSystemPerformanceSnapshot({
          timeoutMs: options.timeoutMs ?? 1000,
          requireCachedAvailability: options.requireCachedAvailability !== false,
        })
      : null,
  ]);
  const state = buildPreloadPerformanceWarningState(
    activitySnapshot,
    performanceSnapshot,
    now
  );

  preloadPerformanceWarningCache = {
    queriedAtMs: now,
    state,
  };

  globalThis.ZeroLatencyDebugEvents?.record?.("preload.performance-warning.state", {
    active: state.active,
    reason: state.reason,
    reasons: state.reasons,
    externalWorkloadRunning: state.externalWorkloadRunning,
    metrics: state.metrics,
  });

  return state;
}

function buildPreloadPerformanceWarningState(activitySnapshot, performanceSnapshot, now = Date.now()) {
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

  const activity = normalizePreloadActivitySnapshot(activitySnapshot);
  const metrics = normalizePreloadPerformanceMetrics(performanceSnapshot);
  const memoryPressure =
    metrics.memoryUsageRatio >= PRELOAD_PERFORMANCE_WARNING_MEMORY_RATIO ||
    (metrics.availableMemoryBytes > 0 &&
      metrics.availableMemoryBytes <= PRELOAD_PERFORMANCE_WARNING_MEMORY_AVAILABLE_BYTES);
  const vramPressure =
    metrics.gpuDedicatedMemory !== null &&
    (metrics.gpuDedicatedMemory.usageRatio >= PRELOAD_PERFORMANCE_WARNING_VRAM_RATIO ||
      (metrics.gpuDedicatedMemory.availableBytes > 0 &&
        metrics.gpuDedicatedMemory.availableBytes <=
          PRELOAD_PERFORMANCE_WARNING_VRAM_AVAILABLE_BYTES));
  const cpuHigh =
    metrics.cpuUsagePercent >= PRELOAD_PERFORMANCE_WARNING_CPU_PERCENT;
  const gpuHigh =
    metrics.gpuUsagePercent !== null &&
    metrics.gpuUsagePercent >= PRELOAD_PERFORMANCE_WARNING_GPU_PERCENT;

  if (activity.externalWorkloadRunning !== true) {
    preloadPerformanceWarningSamples.push({
      atMs: now,
      cpuHigh,
      gpuHigh,
    });
  }
  prunePreloadPerformanceWarningSamples(now);

  const cpuHighSampleCount = preloadPerformanceWarningSamples.filter(
    (sample) => sample.cpuHigh
  ).length;
  const gpuHighSampleCount = preloadPerformanceWarningSamples.filter(
    (sample) => sample.gpuHigh
  ).length;
  const cpuPressure =
    cpuHighSampleCount >= PRELOAD_PERFORMANCE_WARNING_HIGH_SAMPLE_MIN_COUNT;
  const gpuPressure =
    gpuHighSampleCount >= PRELOAD_PERFORMANCE_WARNING_HIGH_SAMPLE_MIN_COUNT;
  const reasons = [];

  if (memoryPressure) {
    reasons.push("memory");
  }

  if (vramPressure) {
    reasons.push("vram");
  }

  if (cpuPressure) {
    reasons.push("cpu");
  }

  if (gpuPressure) {
    reasons.push("gpu");
  }

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
      cpuHighSampleCount,
      gpuHighSampleCount,
      sampleWindowSeconds: PRELOAD_PERFORMANCE_WARNING_SAMPLE_WINDOW_MS / 1000,
    },
    queriedAt,
  };
}

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

function prunePreloadPerformanceWarningSamples(now = Date.now()) {
  const oldestAllowedAt = now - PRELOAD_PERFORMANCE_WARNING_SAMPLE_WINDOW_MS;

  while (
    preloadPerformanceWarningSamples.length > 0 &&
    preloadPerformanceWarningSamples[0].atMs < oldestAllowedAt
  ) {
    preloadPerformanceWarningSamples.shift();
  }
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
      sampleWindowSeconds: PRELOAD_PERFORMANCE_WARNING_SAMPLE_WINDOW_MS / 1000,
    },
    queriedAt: new Date(now).toISOString(),
    ...extra,
  };
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
  preloadWindowManager = globalThis.ZeroLatencyPreloadWindowManager
) {
  const pressureState = await getPreloadResourcePressureState(settings);

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

async function closeHiddenTabsForResourcePressure(
  preloadState,
  normalWindowId,
  normalWindowRuntime,
  preloadWindowManager
) {
  const updatedAt = new Date().toISOString();
  let didMutate = false;

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    let didTouchSource = false;

    for (const entry of Object.values(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
      if (
        entry.tabId !== null ||
        entry.loadedUrl !== null ||
        entry.status !== "closed-resource-pressure"
      ) {
        if (Number.isFinite(entry.tabId)) {
          globalThis.clearKnownPreloadTab?.(entry.tabId);
        }

        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "closed-resource-pressure";
        entry.updatedAt = updatedAt;
        didTouchSource = true;
        didMutate = true;
      }
    }

    if (didTouchSource) {
      sourceTabRuntime.updatedAt = updatedAt;
    }
  }

  if (didMutate) {
    normalWindowRuntime.updatedAt = updatedAt;
    preloadState.updatedAt = updatedAt;
  }

  if (
    await preloadWindowManager?.closeWindowForNormalWindow?.(preloadState, normalWindowId)
  ) {
    didMutate = true;
  }

  if (didMutate) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.close", {
      normalWindowId,
    });
  }

  return didMutate;
}

async function sleepHiddenTabsForResourcePressure(
  preloadState,
  normalWindowId,
  normalWindowRuntime,
  preloadWindowManager
) {
  if (!hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime)) {
    return Boolean(
      await preloadWindowManager?.closeWindowForNormalWindow?.(preloadState, normalWindowId)
    );
  }

  const canDiscardTabs =
    globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "discard") === true;
  const updatedAt = new Date().toISOString();
  let didMutate = false;
  let sleptTabCount = 0;

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    let didTouchSource = false;

    for (const entry of Object.values(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
      const tabId = normalizePositiveInteger(entry.tabId);

      if (tabId === null) {
        continue;
      }

      const liveTab = await getTabMaybe(tabId);

      if (!liveTab) {
        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "missing-resource-pressure";
        entry.updatedAt = updatedAt;
        didTouchSource = true;
        didMutate = true;
        continue;
      }

      if (liveTab.discarded === true && entry.status === "sleeping-resource-pressure") {
        continue;
      }

      try {
        await chrome.tabs.update(tabId, { autoDiscardable: true });
      } catch (_error) {
        // Older Chromium builds may reject autoDiscardable updates.
      }

      let discardedTab = null;

      if (canDiscardTabs) {
        try {
          discardedTab = await chrome.tabs.discard(tabId);
          sleptTabCount += 1;
        } catch (error) {
          globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.sleep.error", {
            normalWindowId,
            tabId,
            error: String(error?.message || error),
          });
        }
      }

      entry.loadedUrl = discardedTab?.url || liveTab.url || entry.loadedUrl;
      entry.status = canDiscardTabs
        ? "sleeping-resource-pressure"
        : "sleep-unsupported-resource-pressure";
      entry.updatedAt = updatedAt;
      didTouchSource = true;
      didMutate = true;
    }

    if (didTouchSource) {
      sourceTabRuntime.updatedAt = updatedAt;
    }
  }

  if (didMutate) {
    normalWindowRuntime.updatedAt = updatedAt;
    preloadState.updatedAt = updatedAt;
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.resource-pressure.sleep", {
      normalWindowId,
      canDiscardTabs,
      sleptTabCount,
    });
  }

  return didMutate;
}

function getPreloadWindowSystemHideSignature(preloadWindowState) {
  if (!preloadWindowState || typeof preloadWindowState !== "object") {
    return "";
  }

  return JSON.stringify({
    hiddenBySystem: preloadWindowState.hiddenBySystem === true,
    hwnd: normalizePositiveFiniteNumber(preloadWindowState.hwnd),
    systemHideFailureCount: clampNonNegativeInt(preloadWindowState.systemHideFailureCount, 0),
    systemHideDisabledUntil: normalizePositiveFiniteNumber(
      preloadWindowState.systemHideDisabledUntil
    ),
    lastSystemHideError:
      typeof preloadWindowState.lastSystemHideError === "string"
        ? preloadWindowState.lastSystemHideError
        : null,
    lastSystemHideFailedAt:
      typeof preloadWindowState.lastSystemHideFailedAt === "string"
        ? preloadWindowState.lastSystemHideFailedAt
        : null,
  });
}
