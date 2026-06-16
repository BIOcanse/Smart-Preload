const NATIVE_MESSAGING_HOST_NAME = "com.zero_latency_web.app";
const NATIVE_APP_WAKE_RETRY_DELAYS_MS = [100, 250, 500, 1000, 1500];
const NATIVE_APP_WAKE_CONNECT_TIMEOUT_MS = 1500;

let nativeAppWakePromise = null;

async function wakeNativeAppHost(options = {}) {
  if (nativeAppWakePromise) {
    return nativeAppWakePromise;
  }

  nativeAppWakePromise = wakeNativeAppHostWithFallbacks(options).finally(() => {
    nativeAppWakePromise = null;
  });

  return nativeAppWakePromise;
}

async function wakeNativeAppHostWithFallbacks(options = {}) {
  const errors = [];

  for (const strategy of [sendNativeAppWakeMessage, connectNativeAppWakePort]) {
    try {
      const response = await strategy(options);
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake.success", {
        strategy: response?.strategy || strategy.name,
        reason: options.reason || "",
      });
      return response;
    } catch (error) {
      errors.push(error);
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake.strategy-error", {
        strategy: strategy.name,
        reason: options.reason || "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const message = errors
    .map((error) => (error instanceof Error ? error.message : String(error)))
    .filter(Boolean)
    .join("; ");
  throw new Error(message || "native host wake failed.");
}

function sendNativeAppWakeMessage() {
  if (typeof globalThis.chrome?.runtime?.sendNativeMessage !== "function") {
    return Promise.reject(new Error("chrome.runtime.sendNativeMessage is unavailable."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settle(false, new Error("native host send wake timed out."));
    }, NATIVE_APP_WAKE_CONNECT_TIMEOUT_MS);

    function settle(ok, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (ok) {
        resolve(value);
      } else {
        reject(value);
      }
    }

    globalThis.chrome.runtime.sendNativeMessage(
      NATIVE_MESSAGING_HOST_NAME,
      {
        type: "zlw:wake-host",
        version: 1,
        requestedAt: Date.now(),
      },
      (response) => {
        const lastError = globalThis.chrome.runtime.lastError;

        if (lastError) {
          settle(false, new Error(lastError.message));
          return;
        }

        if (response?.ok !== true) {
          settle(false, new Error(response?.error || "native host wake failed."));
          return;
        }

        settle(true, {
          ...response,
          strategy: "sendNativeMessage",
        });
      }
    );
  });
}

function connectNativeAppWakePort(options = {}) {
  if (typeof globalThis.chrome?.runtime?.connectNative !== "function") {
    return Promise.reject(new Error("chrome.runtime.connectNative is unavailable."));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let port = null;
    const timeoutId = setTimeout(() => {
      settle(false, new Error("native host connect wake timed out."));
    }, options.timeoutMs ?? NATIVE_APP_WAKE_CONNECT_TIMEOUT_MS);

    function settle(ok, value) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      try {
        port?.onMessage?.removeListener?.(handleMessage);
        port?.onDisconnect?.removeListener?.(handleDisconnect);
        port?.disconnect?.();
      } catch (_error) {
        // Disconnect cleanup must not mask the wake result.
      }

      if (ok) {
        resolve(value);
      } else {
        reject(value);
      }
    }

    function handleMessage(response) {
      if (response?.ok !== true) {
        settle(false, new Error(response?.error || "native host connect wake failed."));
        return;
      }

      settle(true, {
        ...response,
        strategy: "connectNative",
      });
    }

    function handleDisconnect() {
      const lastError = globalThis.chrome.runtime.lastError;

      if (settled) {
        return;
      }

      settle(
        false,
        new Error(lastError?.message || "native host connect wake disconnected.")
      );
    }

    try {
      port = globalThis.chrome.runtime.connectNative(NATIVE_MESSAGING_HOST_NAME);
      port.onMessage.addListener(handleMessage);
      port.onDisconnect.addListener(handleDisconnect);
      port.postMessage({
        type: "zlw:wake-host",
        version: 1,
        requestedAt: Date.now(),
      });
    } catch (error) {
      settle(false, error);
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

globalThis.ZeroLatencyNativeAppWake = {
  wake: wakeNativeAppHost,
  retryDelaysMs: NATIVE_APP_WAKE_RETRY_DELAYS_MS,
};
