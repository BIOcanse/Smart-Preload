const NATIVE_MESSAGING_HOST_NAME = "com.zero_latency_web.app";
const NATIVE_APP_WAKE_RETRY_DELAYS_MS = [100, 250, 500, 1000, 1500];

let nativeAppWakePromise = null;

async function wakeNativeAppHost() {
  if (nativeAppWakePromise) {
    return nativeAppWakePromise;
  }

  nativeAppWakePromise = sendNativeAppWakeMessage().finally(() => {
    nativeAppWakePromise = null;
  });

  return nativeAppWakePromise;
}

function sendNativeAppWakeMessage() {
  if (typeof globalThis.chrome?.runtime?.sendNativeMessage !== "function") {
    return Promise.reject(new Error("chrome.runtime.sendNativeMessage is unavailable."));
  }

  return new Promise((resolve, reject) => {
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
          reject(new Error(lastError.message));
          return;
        }

        if (response?.ok !== true) {
          reject(new Error(response?.error || "native host wake failed."));
          return;
        }

        resolve(response);
      }
    );
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
