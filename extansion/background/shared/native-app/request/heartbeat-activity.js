(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;
  const NATIVE_APP_HEARTBEAT_CLIENT_ID_KEY = "nativeAppHeartbeatClientIdV1";
  let nativeAppHeartbeatClientId = null;
  let nativeAppHeartbeatClientIdPromise = null;

  async function collectNativeAppHeartbeatBrowserActivity() {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("windows", "getAll") !== true) {
      return {};
    }

    try {
      const preloadWindows = await collectNativeAppHeartbeatPreloadWindows();
      const windows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ["normal"],
      });
      const normalWindows = (Array.isArray(windows) ? windows : []).filter(
        (windowInfo) =>
          !preloadWindows.windowIds.has(windowInfo?.id) &&
          !isNativeAppHeartbeatPreloadSentinelWindow(windowInfo)
      );
      const normalTabCount = normalWindows.reduce(
        (sum, windowInfo) => sum + (Array.isArray(windowInfo?.tabs) ? windowInfo.tabs.length : 0),
        0
      );

      return {
        clientId: await getNativeAppHeartbeatClientId(),
        normalWindowCount: normalWindows.length,
        normalTabCount,
        preloadWindowHwnds: [...preloadWindows.hwnds].sort((left, right) => left - right),
      };
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.activity-error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  async function collectNativeAppHeartbeatPreloadWindows() {
    const preloadWindowIds = new Set();
    const preloadWindowHwnds = new Set();
    const runtimeSnapshot = globalThis.snapshotKnownPreloadRuntime?.();

    for (const windowId of runtimeSnapshot?.windowIds || []) {
      const normalizedWindowId = normalizeNativeAppHeartbeatPositiveInteger(windowId);

      if (normalizedWindowId !== null) {
        preloadWindowIds.add(normalizedWindowId);
      }
    }

    if (typeof globalThis.loadPreloadState !== "function") {
      return {
        windowIds: preloadWindowIds,
        hwnds: preloadWindowHwnds,
      };
    }

    try {
      const preloadState = await globalThis.loadPreloadState();

      for (const normalWindowRuntime of Object.values(preloadState?.normalWindowsById || {})) {
        const preloadWindowId = normalizeNativeAppHeartbeatPositiveInteger(
          normalWindowRuntime?.preloadWindow?.windowId
        );
        const preloadWindowHwnd = normalizeNativeAppHeartbeatPositiveInteger(
          normalWindowRuntime?.preloadWindow?.hwnd
        );

        if (preloadWindowId !== null) {
          preloadWindowIds.add(preloadWindowId);
        }

        if (preloadWindowHwnd !== null) {
          preloadWindowHwnds.add(preloadWindowHwnd);
        }
      }
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.preload-state-error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      windowIds: preloadWindowIds,
      hwnds: preloadWindowHwnds,
    };
  }

  async function getNativeAppHeartbeatClientId() {
    if (nativeAppHeartbeatClientId) {
      return nativeAppHeartbeatClientId;
    }

    if (nativeAppHeartbeatClientIdPromise) {
      return nativeAppHeartbeatClientIdPromise;
    }

    nativeAppHeartbeatClientIdPromise = loadOrCreateNativeAppHeartbeatClientId().finally(() => {
      nativeAppHeartbeatClientIdPromise = null;
    });

    return nativeAppHeartbeatClientIdPromise;
  }

  async function loadOrCreateNativeAppHeartbeatClientId() {
    if (
      typeof globalThis.chrome?.storage?.local?.get === "function" &&
      typeof globalThis.chrome?.storage?.local?.set === "function"
    ) {
      const stored = await chrome.storage.local.get({
        [NATIVE_APP_HEARTBEAT_CLIENT_ID_KEY]: null,
      });
      const storedClientId = normalizeNativeAppHeartbeatClientId(
        stored[NATIVE_APP_HEARTBEAT_CLIENT_ID_KEY]
      );

      if (storedClientId) {
        nativeAppHeartbeatClientId = storedClientId;
        return nativeAppHeartbeatClientId;
      }

      nativeAppHeartbeatClientId = createNativeAppHeartbeatClientId();
      await chrome.storage.local.set({
        [NATIVE_APP_HEARTBEAT_CLIENT_ID_KEY]: nativeAppHeartbeatClientId,
      });
      return nativeAppHeartbeatClientId;
    }

    nativeAppHeartbeatClientId = createNativeAppHeartbeatClientId();
    return nativeAppHeartbeatClientId;
  }

  function isNativeAppHeartbeatPreloadSentinelWindow(windowInfo) {
    const sentinelUrl =
      globalThis.PRELOAD_WINDOW_SENTINEL_URL || "about:blank#zero-latency-preload-window";

    return (
      Array.isArray(windowInfo?.tabs) &&
      windowInfo.tabs.some((tab) => typeof tab?.url === "string" && tab.url === sentinelUrl)
    );
  }

  function normalizeNativeAppHeartbeatPositiveInteger(value) {
    const numericValue = Number(value);

    return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
  }

  function normalizeNativeAppHeartbeatClientId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(value)
      ? value
      : null;
  }

  function createNativeAppHeartbeatClientId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return `zlw:${globalThis.crypto.randomUUID()}`;
    }

    return `zlw:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  }

  Object.assign(modules, {
    collectNativeAppHeartbeatBrowserActivity,
  });
})();
