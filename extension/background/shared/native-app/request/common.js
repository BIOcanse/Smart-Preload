(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules || {};

  Object.assign(modules, {
    NATIVE_APP_BASE_URL: "http://127.0.0.1:45831",
    NATIVE_APP_REQUEST_TIMEOUT_MS: 1500,
    NATIVE_APP_EXTENSION_REGISTER_PATH: "/api/v1/extension/register",
    NATIVE_APP_EXTENSION_HEARTBEAT_PATH: "/api/v1/extension/heartbeat",
    NATIVE_APP_EXTENSION_ORIGIN_HEADER: "X-ZLW-Extension-Origin",
    // 只影响配对弹窗的文案语言。弹窗的文字本身由 app 自带 —— 请求方能决定文案的话，
    // 恶意扩展就能把「是否连接？」改写成别的问题。
    NATIVE_APP_EXTENSION_LOCALE_HEADER: "X-ZLW-Extension-Locale",
    NATIVE_APP_HEARTBEAT_ALARM: "native-app-heartbeat",
    NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS: 30,
    NATIVE_APP_WAKE_RETRY_ALARM: "native-app-wake-retry",
    NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS: 30,
    MIN_PACKED_RECURRING_ALARM_SECONDS: 30,
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

    const localeId = getActiveLocaleId();

    if (localeId) {
      headers[modules.NATIVE_APP_EXTENSION_LOCALE_HEADER] = localeId;
    }

    return headers;
  }

  // 用户在设置页选的界面语言；选了「自动」就跟随浏览器语言。
  //
  // 全程不抛：本地 app 的请求路径不能因为读设置失败而整个断掉。拿不到就不发这个头，
  // app 侧会回落英文。
  function getActiveLocaleId() {
    try {
      const languageMode =
        globalThis.getEffectiveExtensionSettings?.()?.appearance?.languageMode ?? "auto";
      return globalThis.ZeroLatencyI18nLocale?.resolveLocaleId?.(languageMode) ?? null;
    } catch (_error) {
      return null;
    }
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
