const NATIVE_APP_BASE_URL = "http://127.0.0.1:45831";
const NATIVE_APP_REQUEST_TIMEOUT_MS = 3000;
const NATIVE_APP_EXTENSION_REGISTER_PATH = "/api/v1/extension/register";
const NATIVE_APP_EXTENSION_ORIGIN_HEADER = "X-ZLW-Extension-Origin";
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
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.offline", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
