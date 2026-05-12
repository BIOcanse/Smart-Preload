(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function fetchNativeApp(path, options = {}) {
    if (options.skipRegistration !== true && path !== modules.NATIVE_APP_EXTENSION_REGISTER_PATH) {
      await modules.ensureNativeAppRegistration();
    }

    const url = `${modules.NATIVE_APP_BASE_URL}${path}`;
    const timeoutMs = options.timeoutMs ?? modules.NATIVE_APP_REQUEST_TIMEOUT_MS;
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
        headers: modules.buildNativeAppHeaders(),
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

  modules.fetchNativeApp = fetchNativeApp;
})();
