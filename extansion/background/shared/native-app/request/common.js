(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules || {};

  Object.assign(modules, {
    NATIVE_APP_BASE_URL: "http://127.0.0.1:45831",
    NATIVE_APP_REQUEST_TIMEOUT_MS: 3000,
    NATIVE_APP_EXTENSION_REGISTER_PATH: "/api/v1/extension/register",
    NATIVE_APP_EXTENSION_HEARTBEAT_PATH: "/api/v1/extension/heartbeat",
    NATIVE_APP_EXTENSION_ORIGIN_HEADER: "X-ZLW-Extension-Origin",
    NATIVE_APP_HEARTBEAT_ALARM: "native-app-heartbeat",
    NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS: 10,
    NATIVE_APP_HEARTBEAT_RECOVERY_DELAYS_MS: [250, 750, 1500],
    NATIVE_APP_WAKE_RETRY_ALARM: "native-app-wake-retry",
    NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS: 10,
  });

  function markNativeAppSystemHidingAvailability(available) {
    try {
      if (globalThis.ZeroLatencySupport?.supportsSystemLevelWindowHiding?.() === true) {
        globalThis.ZeroLatencySupport.setSystemLevelWindowHidingUsable?.(available === true);
      }
    } catch (_error) {
      // Support probing must never break native-app request handling.
    }
  }

  function buildNativeAppHeaders() {
    const headers = {};
    const extensionOrigin = getExtensionOrigin();

    if (extensionOrigin) {
      headers[modules.NATIVE_APP_EXTENSION_ORIGIN_HEADER] = extensionOrigin;
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

  Object.assign(modules, {
    markNativeAppSystemHidingAvailability,
    buildNativeAppHeaders,
    getExtensionOrigin,
  });

  globalThis.ZeroLatencyNativeAppRequestModules = modules;
})();
