const NATIVE_APP_BASE_URL = "http://127.0.0.1:45831";
const NATIVE_APP_REQUEST_TIMEOUT_MS = 3000;
const NATIVE_APP_EXTENSION_REGISTER_PATH = "/api/v1/extension/register";
const NATIVE_APP_EXTENSION_HEARTBEAT_PATH = "/api/v1/extension/heartbeat";
const NATIVE_APP_EXTENSION_ORIGIN_HEADER = "X-ZLW-Extension-Origin";
const NATIVE_APP_HEARTBEAT_ALARM = "native-app-heartbeat";
const NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS = 10;
const NATIVE_APP_HEARTBEAT_RECOVERY_DELAYS_MS = [250, 750, 1500];
let nativeAppRegistrationPromise = null;

async function fetchNativeApp(path, options = {}) {
  if (path !== NATIVE_APP_EXTENSION_REGISTER_PATH) {
    await ensureNativeAppRegistration();
  }

  const url = `${NATIVE_APP_BASE_URL}${path}`;
  const timeoutMs = options.timeoutMs ?? NATIVE_APP_REQUEST_TIMEOUT_MS;
  const method = options.method || "GET";
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  globalThis.ZeroLatencyDebugEvents?.record?.("native-app.request.start", {
    path,
    method,
    timeoutMs,
  });

  try {
    const fetchOptions = {
      method,
      signal: controller.signal,
      headers: buildNativeAppHeaders(),
    };

    if (options.body !== undefined) {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.request.fail", {
        path,
        method,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new Error(`native app responded with ${response.status}`);
    }

    const payload = await response.json();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.request.success", {
      path,
      method,
      durationMs: Date.now() - startedAt,
    });
    return payload;
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.request.error", {
      path,
      method,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      aborted: controller.signal.aborted,
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureNativeAppRegistration() {
  if (nativeAppRegistrationPromise) {
    return nativeAppRegistrationPromise;
  }

  nativeAppRegistrationPromise = fetchNativeAppRegistration().catch((error) => {
    nativeAppRegistrationPromise = null;
    throw error;
  });

  return nativeAppRegistrationPromise;
}

async function fetchNativeAppRegistration() {
  try {
    return await fetchNativeAppRegistrationOnce();
  } catch (firstError) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.wake-requested", {
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });

    await wakeNativeAppHost();

    let lastError = firstError;

    for (const delayMs of NATIVE_APP_WAKE_RETRY_DELAYS_MS) {
      await wait(delayMs);

      try {
        return await fetchNativeAppRegistrationOnce();
      } catch (error) {
        lastError = error;
      }
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.offline", {
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError;
  }
}

async function fetchNativeAppRegistrationOnce() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NATIVE_APP_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.start", {
    timeoutMs: NATIVE_APP_REQUEST_TIMEOUT_MS,
  });

  try {
    const response = await fetch(`${NATIVE_APP_BASE_URL}${NATIVE_APP_EXTENSION_REGISTER_PATH}`, {
      method: "POST",
      signal: controller.signal,
      headers: buildNativeAppHeaders(),
    });

    if (!response.ok) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.fail", {
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new Error(`native app registration responded with ${response.status}`);
    }

    const payload = await response.json();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.success", {
      durationMs: Date.now() - startedAt,
      allowedOrigin: payload?.allowedOrigin || null,
    });
    return payload;
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.error", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      aborted: controller.signal.aborted,
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendNativeAppHeartbeat(reason = "alarm") {
  try {
    const browserActivity = await collectNativeAppHeartbeatBrowserActivity();

    if (browserActivity.normalWindowCount === 0) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.skip-no-normal-window", {
        reason,
        normalTabCount: browserActivity.normalTabCount ?? 0,
      });
      return {
        ok: false,
        skipped: true,
        reason: "no-normal-window",
        normalWindowCount: 0,
      };
    }

    const response = await fetchNativeApp(NATIVE_APP_EXTENSION_HEARTBEAT_PATH, {
      method: "POST",
      body: {
        reason,
        sentAt: new Date().toISOString(),
        ...browserActivity,
      },
      timeoutMs: 1_500,
    });
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.success", {
      reason,
      activeLeaseCount: response?.activeLeaseCount ?? null,
      activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
      normalWindowCount: browserActivity.normalWindowCount ?? null,
    });
    return response;
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.error", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return recoverNativeAppHeartbeat(reason, error);
  }
}

async function recoverNativeAppHeartbeat(reason, firstError) {
  nativeAppRegistrationPromise = null;
  invalidateNativeAppHealthCache?.();
  globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-start", {
    reason,
    error: firstError instanceof Error ? firstError.message : String(firstError),
  });

  const browserActivity = await collectNativeAppHeartbeatBrowserActivity();

  if (browserActivity.normalWindowCount === 0) {
    globalThis.ZeroLatencyDebugEvents?.record?.(
      "native-app.heartbeat.recovery-skip-no-normal-window",
      {
        reason,
        normalTabCount: browserActivity.normalTabCount ?? 0,
      }
    );
    return {
      ok: false,
      skipped: true,
      reason: "no-normal-window",
      normalWindowCount: 0,
    };
  }

  try {
    await wakeNativeAppHost();
  } catch (wakeError) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-wake-error", {
      reason,
      error: wakeError instanceof Error ? wakeError.message : String(wakeError),
    });
  }

  let lastError = firstError;

  for (const delayMs of NATIVE_APP_HEARTBEAT_RECOVERY_DELAYS_MS) {
    await wait(delayMs);

    try {
      await ensureNativeAppRegistration();
      const response = await fetchNativeApp(NATIVE_APP_EXTENSION_HEARTBEAT_PATH, {
        method: "POST",
        body: {
          reason: `${reason}:recovered`,
          sentAt: new Date().toISOString(),
          ...browserActivity,
        },
        timeoutMs: 1_500,
      });
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-success", {
        reason,
        activeLeaseCount: response?.activeLeaseCount ?? null,
        activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
      });
      return response;
    } catch (error) {
      lastError = error;
      nativeAppRegistrationPromise = null;
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-retry-error", {
        reason,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-failed", {
    reason,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return {
    ok: false,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
}

async function collectNativeAppHeartbeatBrowserActivity() {
  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("windows", "getAll") !== true) {
    return {};
  }

  try {
    const preloadWindowIds = await collectNativeAppHeartbeatPreloadWindowIds();
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const normalWindows = (Array.isArray(windows) ? windows : []).filter(
      (windowInfo) =>
        !preloadWindowIds.has(windowInfo?.id) && !isNativeAppHeartbeatPreloadSentinelWindow(windowInfo)
    );
    const normalTabCount = normalWindows.reduce(
      (sum, windowInfo) => sum + (Array.isArray(windowInfo?.tabs) ? windowInfo.tabs.length : 0),
      0
    );

    return {
      normalWindowCount: normalWindows.length,
      normalTabCount,
    };
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.activity-error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function collectNativeAppHeartbeatPreloadWindowIds() {
  const preloadWindowIds = new Set();
  const runtimeSnapshot = globalThis.snapshotKnownPreloadRuntime?.();

  for (const windowId of runtimeSnapshot?.windowIds || []) {
    const normalizedWindowId = normalizeNativeAppHeartbeatPositiveInteger(windowId);

    if (normalizedWindowId !== null) {
      preloadWindowIds.add(normalizedWindowId);
    }
  }

  if (typeof globalThis.loadPreloadState !== "function") {
    return preloadWindowIds;
  }

  try {
    const preloadState = await globalThis.loadPreloadState();

    for (const normalWindowRuntime of Object.values(preloadState?.normalWindowsById || {})) {
      const preloadWindowId = normalizeNativeAppHeartbeatPositiveInteger(
        normalWindowRuntime?.preloadWindow?.windowId
      );

      if (preloadWindowId !== null) {
        preloadWindowIds.add(preloadWindowId);
      }
    }
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.preload-state-error", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return preloadWindowIds;
}

function isNativeAppHeartbeatPreloadSentinelWindow(windowInfo) {
  const sentinelUrl = globalThis.PRELOAD_WINDOW_SENTINEL_URL || "about:blank#zero-latency-preload-window";

  return (
    Array.isArray(windowInfo?.tabs) &&
    windowInfo.tabs.some((tab) => typeof tab?.url === "string" && tab.url === sentinelUrl)
  );
}

function normalizeNativeAppHeartbeatPositiveInteger(value) {
  const numericValue = Number(value);

  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

async function ensureNativeAppHeartbeatAlarm(enabled) {
  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
    return;
  }

  if (enabled !== true) {
    await chrome.alarms.clear(NATIVE_APP_HEARTBEAT_ALARM);
    return;
  }

  const periodInMinutes = NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS / 60;
  await chrome.alarms.create(NATIVE_APP_HEARTBEAT_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });
}

function isNativeAppHeartbeatAlarm(alarmName) {
  return alarmName === NATIVE_APP_HEARTBEAT_ALARM;
}

function buildNativeAppHeaders() {
  const headers = {};
  const extensionOrigin = getExtensionOrigin();

  if (extensionOrigin) {
    headers[NATIVE_APP_EXTENSION_ORIGIN_HEADER] = extensionOrigin;
  }

  return headers;
}

function getExtensionOrigin() {
  const extensionId = globalThis.chrome?.runtime?.id;

  if (typeof extensionId !== "string" || extensionId.length !== 32) {
    return null;
  }

  return `chrome-extension://${extensionId}`;
}

globalThis.ZeroLatencyNativeAppHeartbeat = {
  alarmName: NATIVE_APP_HEARTBEAT_ALARM,
  ensureAlarm: ensureNativeAppHeartbeatAlarm,
  send: sendNativeAppHeartbeat,
  isAlarm: isNativeAppHeartbeatAlarm,
};
