(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;
  let nativeAppRegistrationPromise = null;

  async function ensureNativeAppRegistration() {
    if (nativeAppRegistrationPromise) {
      return nativeAppRegistrationPromise;
    }

    nativeAppRegistrationPromise = fetchNativeAppRegistrationOnce().catch((error) => {
      nativeAppRegistrationPromise = null;
      throw error;
    });

    return nativeAppRegistrationPromise;
  }

  async function fetchNativeAppRegistrationOnce() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), modules.NATIVE_APP_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.start", {
      timeoutMs: modules.NATIVE_APP_REQUEST_TIMEOUT_MS,
    });

    try {
      const response = await fetch(
        `${modules.NATIVE_APP_BASE_URL}${modules.NATIVE_APP_EXTENSION_REGISTER_PATH}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: modules.buildNativeAppHeaders(),
        }
      );

      if (!response.ok) {
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.fail", {
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        throw new Error(`native app registration responded with ${response.status}`);
      }

      const payload = await response.json();
      modules.markNativeAppSystemHidingAvailability(true);
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

  function resetNativeAppRegistration() {
    nativeAppRegistrationPromise = null;
  }

  Object.assign(modules, {
    ensureNativeAppRegistration,
    resetNativeAppRegistration,
  });
})();
