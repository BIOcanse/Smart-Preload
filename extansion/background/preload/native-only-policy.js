const NATIVE_APP_MISSING_WARNING_DELAY_MS = 60 * 1000;
const NATIVE_APP_MISSING_WARNING_STORAGE_KEY = "nativeAppMissingWarningObservedAtMsV1";
const REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES = 24 * 1024 * 1024 * 1024;
const NATIVE_APP_MISSING_WARNING_FALLBACK =
  "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.";
const REAL_PRELOAD_LOW_MEMORY_RECOMMENDATION_FALLBACK =
  "Real Preload is available and can reduce perceived latency to zero, but this computer has less than 24 GB of memory; it is not recommended for most users.";
const REAL_PRELOAD_RECOMMENDED_FALLBACK =
  "Real Preload is available and recommended on this machine. It can reduce perceived latency to zero, but uses a lot of memory; avoid overly aggressive limits.";

const nativeAppMissingWarningState = {
  observedAtMs: null,
};

function isAllNativePreloadModeEnabled(settings = resolveCurrentNativeOnlySettings()) {
  return (
    globalThis.ZeroLatencySettings?.isAllNativePreloadModeEnabled?.(settings) === true ||
    settings?.preloading?.realPreloadEnabled !== true
  );
}

function isRealPreloadEnabled(settings = resolveCurrentNativeOnlySettings()) {
  return (
    globalThis.ZeroLatencySettings?.isRealPreloadEnabled?.(settings) === true ||
    settings?.preloading?.realPreloadEnabled === true
  );
}

function resolveHiddenTabStrategyForNativeOnlyMode(strategy, settings) {
  if (strategy === "hidden-tab" && isAllNativePreloadModeEnabled(settings)) {
    return "prefetch";
  }

  return strategy;
}

async function clearHiddenTabPreloadStateForNativeOnlyMode(
  preloadState,
  settings = resolveCurrentNativeOnlySettings(),
  options = {}
) {
  if (!isAllNativePreloadModeEnabled(settings)) {
    return {
      preloadState,
      mutated: false,
      closedTabIds: [],
      closedWindowIds: [],
    };
  }

  const closedTabIds = [];
  const closedWindowIds = [];
  let mutated = false;

  for (const [normalWindowId, normalWindowRuntime] of Object.entries(
    preloadState?.normalWindowsById || {}
  )) {
    for (const [sourceTabId, sourceTabRuntime] of Object.entries(
      normalWindowRuntime?.sourceTabs || {}
    )) {
      const hiddenEntries = sourceTabRuntime?.hiddenTabEntriesByUrl || {};

      for (const entry of Object.values(hiddenEntries)) {
        if (entry?.tabId != null) {
          await closeTabIfExists(entry.tabId);
          closedTabIds.push(entry.tabId);
        }
      }

      if (Object.keys(hiddenEntries).length > 0) {
        sourceTabRuntime.hiddenTabEntriesByUrl = {};
        sourceTabRuntime.updatedAt = new Date().toISOString();
        normalWindowRuntime.updatedAt = sourceTabRuntime.updatedAt;
        mutated = true;
        globalThis.ZeroLatencyDebugEvents?.record?.("native-only.hidden-tabs.clear-source", {
          normalWindowId,
          sourceTabId,
          reason: options.reason || "native-only-mode",
        });
      }

      pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
    }

    const preloadWindowId = normalizePositiveInteger(
      normalWindowRuntime?.preloadWindow?.windowId
    );

    if (preloadWindowId !== null) {
      const closed =
        await globalThis.ZeroLatencyPreloadWindowManager?.closeWindowForNormalWindow?.(
          preloadState,
          normalWindowId
        );

      if (closed) {
        closedWindowIds.push(preloadWindowId);
        mutated = true;
      }
    }

    pruneNormalWindowRuntime(preloadState, normalWindowId);
  }

  if (mutated) {
    preloadState.updatedAt = new Date().toISOString();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-only.hidden-tabs.clear", {
      closedTabCount: closedTabIds.length,
      closedWindowCount: closedWindowIds.length,
      reason: options.reason || "native-only-mode",
    });
  }

  return {
    preloadState,
    mutated,
    closedTabIds,
    closedWindowIds,
  };
}

async function buildNativeAppModeWarning(settings = resolveCurrentNativeOnlySettings(), options = {}) {
  const nowMs = normalizeWarningNowMs(options.now);

  if (
    !isNativeAppMissingWarningRelevant(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() === true
  ) {
    await resetNativeAppModeWarningState();
    return {
      active: false,
    };
  }

  const observedAtMs = await noteNativeAppMissingObserved(nowMs);
  return buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs);
}

function peekNativeAppModeWarning(settings = resolveCurrentNativeOnlySettings(), options = {}) {
  const nowMs = normalizeWarningNowMs(options.now);

  if (
    !isNativeAppMissingWarningRelevant(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() === true
  ) {
    nativeAppMissingWarningState.observedAtMs = null;
    return {
      active: false,
    };
  }

  const observedAtMs = normalizeObservedAtMs(nativeAppMissingWarningState.observedAtMs);

  if (observedAtMs === null) {
    return {
      active: false,
      reason: "native-app-warning-cache-unavailable",
    };
  }

  return buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs);
}

function buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs) {
  const elapsedMs = Math.max(0, nowMs - observedAtMs);

  if (elapsedMs < NATIVE_APP_MISSING_WARNING_DELAY_MS) {
    return {
      active: false,
      pending: true,
      reason: "native-app-unavailable-pending",
      observedAtMs,
      delayMs: NATIVE_APP_MISSING_WARNING_DELAY_MS,
      remainingMs: NATIVE_APP_MISSING_WARNING_DELAY_MS - elapsedMs,
    };
  }

  return {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback: NATIVE_APP_MISSING_WARNING_FALLBACK,
    observedAtMs,
    delayMs: NATIVE_APP_MISSING_WARNING_DELAY_MS,
  };
}

function buildRealPreloadRecommendationWarning(
  settings = resolveCurrentNativeOnlySettings(),
  performanceWarning = null
) {
  if (
    settings?.preloading?.enabled !== true ||
    isRealPreloadEnabled(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() !== true
  ) {
    return {
      active: false,
    };
  }

  const totalMemoryBytes = extractTotalMemoryBytesFromPerformanceWarning(performanceWarning);

  if (totalMemoryBytes <= 0) {
    return {
      active: false,
      reason: "real-preload-memory-unavailable",
    };
  }

  const lowMemory =
    totalMemoryBytes < REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES;

  return {
    active: true,
    reason: lowMemory ? "real-preload-low-memory" : "real-preload-recommended",
    messageKey: lowMemory
      ? "realPreloadAvailableLowMemoryWarning"
      : "realPreloadRecommendedWarning",
    messageFallback: lowMemory
      ? REAL_PRELOAD_LOW_MEMORY_RECOMMENDATION_FALLBACK
      : REAL_PRELOAD_RECOMMENDED_FALLBACK,
    totalMemoryBytes,
    thresholdMemoryBytes: REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES,
  };
}

async function handleSystemLevelWindowHidingUsabilityChange(usable, options = {}) {
  const settings = options.settings ?? resolveCurrentNativeOnlySettings();

  if (usable === true || !isNativeAppMissingWarningRelevant(settings)) {
    await resetNativeAppModeWarningState();
    return;
  }

  await noteNativeAppMissingObserved(options.now);
}

function isNativeAppMissingWarningRelevant(settings = resolveCurrentNativeOnlySettings()) {
  return (
    settings?.preloading?.enabled === true &&
    isRealPreloadEnabled(settings) &&
    globalThis.ZeroLatencySupport?.supportsSystemLevelWindowHiding?.() === true
  );
}

function extractTotalMemoryBytesFromPerformanceWarning(performanceWarning) {
  const value =
    performanceWarning?.metrics?.totalMemoryBytes ??
    performanceWarning?.performanceSnapshot?.system?.totalMemoryBytes ??
    performanceWarning?.performanceSnapshot?.system?.total_memory_bytes ??
    0;
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

async function noteNativeAppMissingObserved(now = undefined) {
  const nowMs = normalizeWarningNowMs(now);
  const storedObservedAtMs = await readNativeAppMissingObservedAtMs();
  const observedAtMs =
    storedObservedAtMs === null || nowMs < storedObservedAtMs
      ? nowMs
      : storedObservedAtMs;

  if (observedAtMs !== storedObservedAtMs) {
    await writeNativeAppMissingObservedAtMs(observedAtMs);
  }

  return observedAtMs;
}

function normalizeWarningNowMs(value) {
  const normalized = Number(value);
  if (Number.isFinite(normalized) && normalized >= 0) {
    return normalized;
  }

  return Date.now();
}

function normalizeObservedAtMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

async function resetNativeAppModeWarningState() {
  nativeAppMissingWarningState.observedAtMs = null;
  await removeNativeAppMissingObservedAtMs();
}

async function readNativeAppMissingObservedAtMs() {
  const storedValue = await readNativeAppMissingObservedAtMsFromStorage();

  if (storedValue !== null && storedValue !== undefined) {
    const normalized = Number(storedValue);

    if (Number.isFinite(normalized) && normalized >= 0) {
      nativeAppMissingWarningState.observedAtMs = normalized;
      return normalized;
    }
  }

  if (
    nativeAppMissingWarningState.observedAtMs !== null &&
    nativeAppMissingWarningState.observedAtMs !== undefined
  ) {
    const memoryValue = Number(nativeAppMissingWarningState.observedAtMs);

    if (Number.isFinite(memoryValue) && memoryValue >= 0) {
      return memoryValue;
    }
  }

  return null;
}

async function readNativeAppMissingObservedAtMsFromStorage() {
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.get !== "function") {
    return null;
  }

  try {
    const result = await storageArea.get(NATIVE_APP_MISSING_WARNING_STORAGE_KEY);
    return result?.[NATIVE_APP_MISSING_WARNING_STORAGE_KEY] ?? null;
  } catch (_error) {
    return null;
  }
}

async function writeNativeAppMissingObservedAtMs(observedAtMs) {
  nativeAppMissingWarningState.observedAtMs = observedAtMs;
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.set !== "function") {
    return;
  }

  try {
    await storageArea.set({
      [NATIVE_APP_MISSING_WARNING_STORAGE_KEY]: observedAtMs,
    });
  } catch (_error) {
    // Memory fallback is enough when session storage is unavailable.
  }
}

async function removeNativeAppMissingObservedAtMs() {
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.remove !== "function") {
    return;
  }

  try {
    await storageArea.remove(NATIVE_APP_MISSING_WARNING_STORAGE_KEY);
  } catch (_error) {
    // Memory fallback was already cleared by resetNativeAppModeWarningState().
  }
}

function getNativeAppMissingWarningStorageArea() {
  return globalThis.chrome?.storage?.session ?? globalThis.chrome?.storage?.local ?? null;
}

function resolveCurrentNativeOnlySettings() {
  return typeof getEffectiveExtensionSettings === "function"
    ? getEffectiveExtensionSettings()
    : null;
}

globalThis.ZeroLatencyPreloadNativeOnlyPolicy = {
  NATIVE_APP_MISSING_WARNING_DELAY_MS,
  REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES,
  isRealPreloadEnabled,
  isAllNativePreloadModeEnabled,
  resolveHiddenTabStrategyForNativeOnlyMode,
  clearHiddenTabPreloadStateForNativeOnlyMode,
  buildNativeAppModeWarning,
  peekNativeAppModeWarning,
  buildRealPreloadRecommendationWarning,
  handleSystemLevelWindowHidingUsabilityChange,
  resetNativeAppModeWarningState,
};
