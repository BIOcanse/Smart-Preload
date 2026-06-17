const PRELOAD_WINDOW_SYSTEM_HIDE_FAILURE_THRESHOLD = 3;
const PRELOAD_WINDOW_SYSTEM_HIDE_BACKOFF_MS = 30_000;

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
