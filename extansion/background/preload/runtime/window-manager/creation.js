const preloadWindowEnsurePromisesByNormalWindowId = new Map();
const PRELOAD_WINDOW_HWND_POLL_MS = 50;
const PRELOAD_WINDOW_HWND_WAIT_MS = 1000;
const SYSTEM_HIDING_REPROBE_INTERVAL_MS = 10_000;
const PRELOAD_WINDOW_SYSTEM_HIDE_FAILURE_THRESHOLD = 3;
const PRELOAD_WINDOW_SYSTEM_HIDE_BACKOFF_MS = 30_000;
let lastSystemHidingReprobeAt = 0;
let systemHidingReprobePromise = null;

// This file is part of the preload runtime maintenance subsystem under the
// watchdog path. Keep it focused on window ensure/reuse/hide lifecycle only.

async function ensurePreloadWindow(preloadState, normalWindowId) {
  const normalizedWindowId = String(normalWindowId);
  const inFlightPromise = preloadWindowEnsurePromisesByNormalWindowId.get(normalizedWindowId);

  if (inFlightPromise) {
    return inFlightPromise;
  }

  const ensurePromise = ensurePreloadWindowInternal(preloadState, normalWindowId).finally(() => {
    preloadWindowEnsurePromisesByNormalWindowId.delete(normalizedWindowId);
  });
  preloadWindowEnsurePromisesByNormalWindowId.set(normalizedWindowId, ensurePromise);
  return ensurePromise;
}

async function ensurePreloadWindowInternal(preloadState, normalWindowId) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.unsupported", {
      normalWindowId,
    });
    return {
      windowId: null,
      created: false,
      supported: false,
    };
  }

  const normalWindowRuntime = ensureNormalWindowRuntime(preloadState, normalWindowId);
  const existingWindowId = normalWindowRuntime.preloadWindow.windowId;
  const useSystemHiding = await resolveSystemHidingUsableForPreloadWindow();

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.request", {
    normalWindowId,
    existingWindowId: normalizePositiveFiniteNumber(existingWindowId),
    useSystemHiding,
  });

  const trackedWindowResult = await tryReuseTrackedPreloadWindow({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    existingWindowId,
    useSystemHiding,
  });

  if (trackedWindowResult) {
    return trackedWindowResult;
  }

  const discoveredWindowResult = await tryReuseDiscoveredPreloadWindow({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    useSystemHiding,
  });

  if (discoveredWindowResult) {
    return discoveredWindowResult;
  }

  return await createPreloadWindowForRuntime({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    useSystemHiding,
  });
}

async function tryReuseTrackedPreloadWindow({
  normalWindowRuntime,
  normalWindowId,
  existingWindowId,
  useSystemHiding,
}) {
  if (Number.isFinite(existingWindowId)) {
    const existingWindow = await getWindowMaybe(existingWindowId);
    // Chrome window IDs are session-scoped and can be reused after restart/profile switch.
    // Never hide a persisted window id unless the live window still proves it is ours.
    const existingWindowStillLooksLikePreloadWindow =
      existingWindow?.type === "normal" &&
      (await isLivePreloadWindowForRuntime(normalWindowRuntime, existingWindow.id));

    if (existingWindowStillLooksLikePreloadWindow) {
      globalThis.markKnownPreloadWindow?.(existingWindow.id);
      await ensurePreloadWindowHiddenState({
        normalWindowRuntime,
        windowId: existingWindow.id,
        actualWindow: existingWindow,
        useSystemHiding,
      });
      await refocusNormalWindowIfPreloadWindowFocused(
        existingWindow.id,
        normalWindowId,
        "reuse-tracked"
      );
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-tracked", {
        normalWindowId,
        preloadWindowId: existingWindow.id,
        hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
        hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
      });

      return {
        windowId: existingWindow.id,
        created: false,
        hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
      };
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.stale-window", {
      normalWindowId,
      existingWindowId,
      reason: existingWindow?.type === "normal" ? "identity-mismatch" : "missing-window",
    });
    globalThis.clearKnownPreloadWindow?.(existingWindowId);
    resetPreloadWindowState(normalWindowRuntime.preloadWindow);
  }

  return null;
}

async function tryReuseDiscoveredPreloadWindow({
  preloadState,
  normalWindowRuntime,
  normalWindowId,
  useSystemHiding,
}) {
  const reusableWindowId = await findReusablePreloadWindowId(preloadState, normalWindowId);

  if (Number.isFinite(reusableWindowId)) {
    commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, reusableWindowId);
    const reusableWindow = await getWindowMaybe(reusableWindowId);
    globalThis.markKnownPreloadWindow?.(reusableWindowId);

    if (reusableWindow?.type === "normal") {
      await ensurePreloadWindowHiddenState({
        normalWindowRuntime,
        windowId: reusableWindowId,
        actualWindow: reusableWindow,
        useSystemHiding,
      });
      await refocusNormalWindowIfPreloadWindowFocused(
        reusableWindowId,
        normalWindowId,
        "reuse-discovered"
      );
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-discovered-selected", {
      normalWindowId,
      preloadWindowId: reusableWindowId,
      hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
      hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
    });

    return {
      windowId: reusableWindowId,
      created: false,
      hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    };
  }

  return null;
}

async function createPreloadWindowForRuntime({
  preloadState,
  normalWindowRuntime,
  normalWindowId,
  useSystemHiding,
}) {
  const previousChromeWindowHwnds = useSystemHiding
    ? await captureNativeChromeWindowHwnds()
    : null;

  const createdWindow = await chrome.windows.create({
    url: PRELOAD_WINDOW_SENTINEL_URL,
    focused: false,
    state: "minimized",
    type: "normal",
  });
  await ensurePreloadWindowHiddenState({
    normalWindowRuntime,
    windowId: createdWindow.id,
    actualWindow:
      (await getWindowMaybe(createdWindow.id)) ?? createdWindow,
    useSystemHiding,
    previousChromeWindowHwnds,
  });
  await refocusNormalWindowIfPreloadWindowFocused(
    createdWindow.id,
    normalWindowId,
    "created"
  );
  globalThis.markKnownPreloadWindow?.(createdWindow.id);

  commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, createdWindow.id);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.created", {
    normalWindowId,
    preloadWindowId: createdWindow.id,
    useSystemHiding,
    hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
  });
  return {
    windowId: createdWindow.id,
    created: true,
    supported: true,
    hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
  };
}

function commitPreloadWindowRuntimeState(preloadState, normalWindowRuntime, preloadWindowId) {
  normalWindowRuntime.preloadWindow.windowId = preloadWindowId;
  normalWindowRuntime.preloadWindow.updatedAt = new Date().toISOString();
  normalWindowRuntime.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
  preloadState.updatedAt = normalWindowRuntime.preloadWindow.updatedAt;
}

async function resolveSystemHidingUsableForPreloadWindow() {
  const supportApi = globalThis.ZeroLatencySupport;

  if (supportApi?.isSystemLevelWindowHidingUsable?.() === true) {
    return true;
  }

  if (supportApi?.supportsSystemLevelWindowHiding?.() !== true) {
    return false;
  }

  const now = Date.now();
  if (now - lastSystemHidingReprobeAt < SYSTEM_HIDING_REPROBE_INTERVAL_MS) {
    return false;
  }

  if (!systemHidingReprobePromise) {
    lastSystemHidingReprobeAt = now;
    systemHidingReprobePromise = supportApi
      .probeNativeAppAvailability?.({ forceRefresh: true })
      .catch(() => false)
      .finally(() => {
        systemHidingReprobePromise = null;
      });
  }

  return (await systemHidingReprobePromise) === true;
}

async function refocusNormalWindowIfPreloadWindowFocused(
  preloadWindowId,
  normalWindowId,
  reason
) {
  const normalizedPreloadWindowId = normalizePositiveFiniteNumber(preloadWindowId);
  const normalizedNormalWindowId = normalizePositiveFiniteNumber(normalWindowId);

  if (normalizedPreloadWindowId === null || normalizedNormalWindowId === null) {
    return;
  }

  const preloadWindow = await getWindowMaybe(normalizedPreloadWindowId);

  if (preloadWindow?.focused !== true) {
    return;
  }

  try {
    await chrome.windows.update(normalizedNormalWindowId, { focused: true });
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.focus.restore-source", {
      preloadWindowId: normalizedPreloadWindowId,
      normalWindowId: normalizedNormalWindowId,
      reason,
    });
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.focus.restore-source-failed", {
      preloadWindowId: normalizedPreloadWindowId,
      normalWindowId: normalizedNormalWindowId,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensurePreloadWindowHiddenState({
  normalWindowRuntime,
  windowId,
  actualWindow,
  useSystemHiding,
  previousChromeWindowHwnds = null,
}) {
  const existingHiddenHwnd = normalizePositiveFiniteNumber(
    normalWindowRuntime?.preloadWindow?.hwnd
  );
  const alreadyHiddenBySystem =
    useSystemHiding &&
    normalWindowRuntime?.preloadWindow?.hiddenBySystem === true &&
    existingHiddenHwnd !== null &&
    previousChromeWindowHwnds === null;

  if (alreadyHiddenBySystem) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-skip-already-hidden", {
      windowId,
      hwnd: existingHiddenHwnd,
    });
    return;
  }

  if (useSystemHiding) {
    const didHideBySystem = await hidePreloadWindowBySystem({
      normalWindowRuntime,
      windowId,
      actualWindow,
      previousChromeWindowHwnds,
    });

    if (didHideBySystem) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-success", {
        windowId,
        hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
      });
      return;
    }
  }

  try {
    await chrome.windows.update(windowId, { state: "minimized" });
  } catch (_error) {
    // Fallback minimize may fail transiently.
  }

  normalWindowRuntime.preloadWindow.hwnd = null;
  normalWindowRuntime.preloadWindow.hiddenBySystem = false;
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.minimize-fallback", {
    windowId,
    useSystemHiding,
  });
}

async function hidePreloadWindowBySystem({
  normalWindowRuntime,
  windowId,
  actualWindow,
  previousChromeWindowHwnds = null,
}) {
  if (typeof globalThis.nativeAppHideWindow !== "function") {
    return false;
  }

  const preloadWindowState = normalWindowRuntime?.preloadWindow;
  const hideBackoff = getPreloadWindowSystemHideBackoff(preloadWindowState);

  if (hideBackoff.active) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-backoff-skip", {
      windowId,
      disabledUntil: hideBackoff.disabledUntil,
      remainingMs: hideBackoff.remainingMs,
    });
    return false;
  }

  const liveWindow = actualWindow ?? (await getWindowMaybe(windowId));

  if (!liveWindow) {
    return false;
  }

  const resolvedHwnd =
    normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd) ??
    (await detectCreatedPreloadWindowHwnd(previousChromeWindowHwnds, liveWindow)) ??
    (await detectChromeWindowHwndByBounds(liveWindow));
  const hideResult = await nativeAppHideWindow({
    hwnd: resolvedHwnd ?? undefined,
    left: liveWindow.left,
    top: liveWindow.top,
    width: liveWindow.width,
    height: liveWindow.height,
  });

  if (hideResult?.ok === true) {
    normalWindowRuntime.preloadWindow.hwnd =
      normalizePositiveFiniteNumber(hideResult.hwnd) ?? resolvedHwnd ?? null;
    normalWindowRuntime.preloadWindow.hiddenBySystem = true;
    recordPreloadWindowSystemHideSuccess(
      normalWindowRuntime.preloadWindow,
      normalWindowRuntime.preloadWindow.hwnd
    );
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-result", {
      windowId,
      ok: true,
      hwnd: normalizePositiveFiniteNumber(normalWindowRuntime.preloadWindow.hwnd),
    });
    return true;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.hide.system-result", {
    windowId,
    ok: false,
    resolvedHwnd,
    error: hideResult?.error || null,
  });
  recordPreloadWindowSystemHideFailure(
    normalWindowRuntime?.preloadWindow,
    hideResult?.error || "native-hide-failed"
  );
  return false;
}

function getPreloadWindowSystemHideBackoff(preloadWindowState) {
  const disabledUntil = normalizePositiveFiniteNumber(
    preloadWindowState?.systemHideDisabledUntil
  );
  const now = Date.now();

  if (disabledUntil === null || disabledUntil <= now) {
    if (preloadWindowState && disabledUntil !== null) {
      preloadWindowState.systemHideDisabledUntil = null;
    }
    return {
      active: false,
      disabledUntil: null,
      remainingMs: 0,
    };
  }

  return {
    active: true,
    disabledUntil,
    remainingMs: Math.max(0, Math.ceil(disabledUntil - now)),
  };
}

function isPreloadWindowSystemHideBackoffActive(preloadWindowState) {
  return getPreloadWindowSystemHideBackoff(preloadWindowState).active;
}

function recordPreloadWindowSystemHideSuccess(preloadWindowState, hwnd = null) {
  if (!preloadWindowState || typeof preloadWindowState !== "object") {
    return;
  }

  preloadWindowState.hwnd = normalizePositiveFiniteNumber(hwnd);
  preloadWindowState.hiddenBySystem = preloadWindowState.hwnd !== null;
  preloadWindowState.systemHideFailureCount = 0;
  preloadWindowState.systemHideDisabledUntil = null;
  preloadWindowState.lastSystemHideError = null;
  preloadWindowState.lastSystemHideFailedAt = null;
  preloadWindowState.updatedAt = new Date().toISOString();
}

function recordPreloadWindowSystemHideFailure(preloadWindowState, error) {
  if (!preloadWindowState || typeof preloadWindowState !== "object") {
    return;
  }

  const nextFailureCount =
    clampNonNegativeInt(preloadWindowState.systemHideFailureCount, 0) + 1;
  preloadWindowState.hiddenBySystem = false;
  preloadWindowState.hwnd = null;
  preloadWindowState.systemHideFailureCount = nextFailureCount;
  preloadWindowState.lastSystemHideError =
    typeof error === "string" && error ? error : "native-hide-failed";
  preloadWindowState.lastSystemHideFailedAt = new Date().toISOString();

  if (nextFailureCount >= PRELOAD_WINDOW_SYSTEM_HIDE_FAILURE_THRESHOLD) {
    preloadWindowState.systemHideDisabledUntil =
      Date.now() + PRELOAD_WINDOW_SYSTEM_HIDE_BACKOFF_MS;
  }

  preloadWindowState.updatedAt = new Date().toISOString();
}

async function captureNativeChromeWindowHwnds() {
  if (typeof globalThis.nativeAppListChromeWindows !== "function") {
    return null;
  }

  const windows = await nativeAppListChromeWindows();

  if (!Array.isArray(windows)) {
    return null;
  }

  return new Set(
    windows
      .map((window) => normalizePositiveFiniteNumber(window?.hwnd))
      .filter((hwnd) => Number.isFinite(hwnd))
  );
}

async function detectCreatedPreloadWindowHwnd(previousChromeWindowHwnds, actualWindow) {
  if (!(previousChromeWindowHwnds instanceof Set)) {
    return null;
  }

  const deadline = Date.now() + PRELOAD_WINDOW_HWND_WAIT_MS;

  while (Date.now() <= deadline) {
    const windows = await getNativeChromeWindows();
    const createdWindowCandidates = windows.filter((window) => {
      const hwnd = normalizePositiveFiniteNumber(window?.hwnd);

      return Number.isFinite(hwnd) && !previousChromeWindowHwnds.has(hwnd);
    });
    const bestCandidate =
      pickBestChromeWindowByBounds(createdWindowCandidates, actualWindow) ??
      createdWindowCandidates[0] ??
      null;
    const bestCandidateHwnd = normalizePositiveFiniteNumber(bestCandidate?.hwnd);

    if (Number.isFinite(bestCandidateHwnd)) {
      return bestCandidateHwnd;
    }

    await sleepPreloadWindowHwndPoll();
  }

  return null;
}

async function detectChromeWindowHwndByBounds(actualWindow) {
  const windows = await getNativeChromeWindows();
  const bestCandidate = pickBestChromeWindowByBounds(windows, actualWindow);

  return normalizePositiveFiniteNumber(bestCandidate?.hwnd);
}

async function getNativeChromeWindows() {
  if (typeof globalThis.nativeAppListChromeWindows !== "function") {
    return [];
  }

  try {
    const windows = await nativeAppListChromeWindows();
    return Array.isArray(windows) ? windows : [];
  } catch (_error) {
    return [];
  }
}

function pickBestChromeWindowByBounds(windows, actualWindow) {
  const liveWindow = actualWindow ?? {};

  return [...(Array.isArray(windows) ? windows : [])]
    .filter((window) => matchesChromeWindowBounds(window, liveWindow))
    .sort((left, right) => {
      if (Boolean(left?.visible) !== Boolean(right?.visible)) {
        return Number(Boolean(right?.visible)) - Number(Boolean(left?.visible));
      }

      if (Boolean(left?.toolWindow) !== Boolean(right?.toolWindow)) {
        return Number(Boolean(left?.toolWindow)) - Number(Boolean(right?.toolWindow));
      }

      if (Boolean(left?.minimized) !== Boolean(right?.minimized)) {
        return Number(Boolean(left?.minimized)) - Number(Boolean(right?.minimized));
      }

      return 0;
    })[0] ?? null;
}

function matchesChromeWindowBounds(window, actualWindow) {
  const actualLeft = normalizeFiniteNumber(actualWindow?.left);
  const actualTop = normalizeFiniteNumber(actualWindow?.top);
  const actualWidth = normalizeFiniteNumber(actualWindow?.width);
  const actualHeight = normalizeFiniteNumber(actualWindow?.height);
  const candidateLeft = normalizeFiniteNumber(window?.left);
  const candidateTop = normalizeFiniteNumber(window?.top);
  const candidateWidth = normalizeFiniteNumber(window?.width);
  const candidateHeight = normalizeFiniteNumber(window?.height);

  if (
    !Number.isFinite(actualLeft) ||
    !Number.isFinite(actualTop) ||
    !Number.isFinite(actualWidth) ||
    !Number.isFinite(actualHeight) ||
    !Number.isFinite(candidateLeft) ||
    !Number.isFinite(candidateTop) ||
    !Number.isFinite(candidateWidth) ||
    !Number.isFinite(candidateHeight)
  ) {
    return false;
  }

  return (
    Math.abs(candidateLeft - actualLeft) <= 10 &&
    Math.abs(candidateTop - actualTop) <= 10 &&
    Math.abs(candidateWidth - actualWidth) <= 10 &&
    Math.abs(candidateHeight - actualHeight) <= 10
  );
}

async function sleepPreloadWindowHwndPoll() {
  await new Promise((resolve) => {
    setTimeout(resolve, PRELOAD_WINDOW_HWND_POLL_MS);
  });
}

function normalizeFiniteNumber(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

async function findReusablePreloadWindowId(preloadState, normalWindowId) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return null;
  }

  const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

  if (!normalWindowRuntime) {
    return null;
  }

  const candidateWindowCounts = new Map();

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    for (const entry of Object.values(sourceTabRuntime.hiddenTabEntriesByUrl || {})) {
      if (!Number.isFinite(entry?.tabId)) {
        continue;
      }

      const liveTab = await getTabMaybe(entry.tabId);

      if (
        liveTab?.windowId &&
        Number.isFinite(liveTab.windowId) &&
        preloadEntryMatchesLiveTab(entry, liveTab)
      ) {
        candidateWindowCounts.set(
          liveTab.windowId,
          (candidateWindowCounts.get(liveTab.windowId) ?? 0) + 1
        );
      }
    }
  }

  if (candidateWindowCounts.size === 0) {
    return null;
  }

  const candidateWindows = [];

  for (const [windowId, trackedTabCount] of candidateWindowCounts.entries()) {
    const candidateWindow = await getWindowMaybe(windowId);

    if (candidateWindow?.type !== "normal") {
      continue;
    }

    candidateWindows.push({
      windowId: candidateWindow.id,
      trackedTabCount,
      minimized: candidateWindow.state === "minimized",
      focused: candidateWindow.focused === true,
    });
  }

  candidateWindows.sort((left, right) => {
    if (right.trackedTabCount !== left.trackedTabCount) {
      return right.trackedTabCount - left.trackedTabCount;
    }

    if (left.focused !== right.focused) {
      return Number(left.focused) - Number(right.focused);
    }

    if (left.minimized !== right.minimized) {
      return Number(right.minimized) - Number(left.minimized);
    }

    return left.windowId - right.windowId;
  });

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-discovered", {
    normalWindowId,
    preloadWindowId: candidateWindows[0]?.windowId ?? null,
    candidateCount: candidateWindows.length,
  });
  return candidateWindows[0]?.windowId ?? null;
}

async function isLivePreloadWindowForRuntime(normalWindowRuntime, windowId) {
  const normalizedWindowId = normalizePositiveInteger(windowId);

  if (normalizedWindowId === null) {
    return false;
  }

  let tabs = [];

  try {
    tabs = await chrome.tabs.query({ windowId: normalizedWindowId });
  } catch (_error) {
    return false;
  }

  if (tabs.some((tab) => tab.url === PRELOAD_WINDOW_SENTINEL_URL)) {
    return true;
  }

  const trackedEntries = Object.values(normalWindowRuntime?.sourceTabs || {})
    .flatMap((sourceTabRuntime) =>
      Object.values(sourceTabRuntime?.hiddenTabEntriesByUrl || {})
    )
    .filter((entry) => normalizePositiveInteger(entry?.tabId) !== null);

  if (trackedEntries.length === 0) {
    return false;
  }

  const liveTabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  return trackedEntries.some((entry) => {
    const liveTab = liveTabsById.get(entry.tabId);

    return liveTab ? preloadEntryMatchesLiveTab(entry, liveTab) : false;
  });
}

function preloadEntryMatchesLiveTab(entry, liveTab) {
  if (!entry || !liveTab) {
    return false;
  }

  const liveUrl = normalizePageUrlForIndex(liveTab.url || "");
  const requestedUrl = normalizePageUrlForIndex(entry.requestedUrl || "");
  const loadedUrl = normalizePageUrlForIndex(entry.loadedUrl || "");

  return Boolean(
    liveUrl &&
      ((requestedUrl && liveUrl === requestedUrl) || (loadedUrl && liveUrl === loadedUrl))
  );
}
