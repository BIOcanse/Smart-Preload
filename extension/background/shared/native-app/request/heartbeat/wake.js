(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function probeNativeAppAvailableForWakeRetry() {
    if (typeof nativeAppHealthCheck !== "function") {
      return false;
    }

    try {
      return (await nativeAppHealthCheck({ forceRefresh: true })) === true;
    } catch (_error) {
      return false;
    }
  }

  function wakeNativeAppHostFromHeartbeat(reason) {
    if (typeof globalThis.ZeroLatencyNativeAppWake?.wake === "function") {
      return globalThis.ZeroLatencyNativeAppWake.wake({ reason });
    }

    return wakeNativeAppHost({ reason });
  }

  Object.assign(modules, {
    probeNativeAppAvailableForWakeRetry,
    wakeNativeAppHostFromHeartbeat,
  });
})();
