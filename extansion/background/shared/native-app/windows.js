async function nativeAppHideWindow(windowBounds) {
  try {
    const response = await fetchNativeApp("/api/v1/windows/hide", {
      method: "POST",
      body: {
        hwnd: normalizePositiveFiniteNumber(windowBounds?.hwnd, undefined),
        left: windowBounds.left,
        top: windowBounds.top,
        width: windowBounds.width,
        height: windowBounds.height,
      },
    });

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.hide.result", {
      ok: response?.ok === true,
      hwnd: normalizePositiveFiniteNumber(response?.hwnd, null),
      error: response?.error || null,
    });
    return response ?? { ok: false, error: "empty response" };
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.hide.error", {
      error: String(error?.message || error),
    });
    return { ok: false, error: String(error?.message || error) };
  }
}

async function nativeAppShowWindow(hwnd) {
  try {
    const response = await fetchNativeApp("/api/v1/windows/show", {
      method: "POST",
      body: { hwnd: normalizePositiveFiniteNumber(hwnd, undefined) },
    });

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.show.result", {
      ok: response?.ok === true,
      hwnd: normalizePositiveFiniteNumber(response?.hwnd, null),
      error: response?.error || null,
    });
    return response ?? { ok: false, error: "empty response" };
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.show.error", {
      error: String(error?.message || error),
    });
    return { ok: false, error: String(error?.message || error) };
  }
}

async function nativeAppListChromeWindows() {
  try {
    return await fetchNativeApp("/api/v1/windows/chrome", {
      method: "GET",
    });
  } catch (_error) {
    return [];
  }
}

async function nativeAppGetHiddenWindowMonitor() {
  try {
    const response = await fetchNativeApp("/api/v1/windows/monitor-snapshot-read", {
      method: "POST",
      body: {},
    });
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.monitor.result", {
      ok: response != null,
      hookInstalled: response?.hookInstalled === true,
      trackedWindowCount: Array.isArray(response?.trackedWindows)
        ? response.trackedWindows.length
        : 0,
      runtimeEventCount: Array.isArray(response?.recentRuntimeEvents)
        ? response.recentRuntimeEvents.length
        : 0,
    });
    return response;
  } catch (_error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.windows.monitor.error", null);
    return null;
  }
}
