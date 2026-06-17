(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function runNativeAppWakeRetryInternal(reason = "alarm") {
    const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

    if (browserActivity.normalWindowCount === 0) {
      await modules.ensureNativeAppWakeRetryAlarm(false);
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.skip-no-normal-window", {
        reason,
        normalTabCount: browserActivity.normalTabCount ?? 0,
      });
      return {
        ok: false,
        skipped: true,
        reason: "no-normal-window",
        normalWindowCount: 0,
      };
    }

    if (await modules.probeNativeAppAvailableForWakeRetry()) {
      await modules.ensureNativeAppWakeRetryAlarm(false);
      modules.markNativeAppSystemHidingAvailability(true);
      modules.resetNativeAppRegistration();
      return modules.sendNativeAppHeartbeat(`${reason}:health-ok`);
    }

    let lastError = null;

    try {
      await modules.wakeNativeAppHostFromHeartbeat(`${reason}:wake-retry`);
    } catch (error) {
      lastError = error;
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.wake-error", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    for (const delayMs of globalThis.ZeroLatencyNativeAppWake?.retryDelaysMs || [250, 750, 1500]) {
      await wait(delayMs);

      try {
        modules.resetNativeAppRegistration();
        await modules.ensureNativeAppRegistration();
        const response = await modules.fetchNativeApp(modules.NATIVE_APP_EXTENSION_HEARTBEAT_PATH, {
          method: "POST",
          body: {
            reason: `${reason}:wake-retry-recovered`,
            sentAt: new Date().toISOString(),
            ...browserActivity,
          },
          timeoutMs: 1_500,
        });
        await modules.ensureNativeAppWakeRetryAlarm(false);
        modules.markNativeAppSystemHidingAvailability(true);
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.success", {
          reason,
          activeLeaseCount: response?.activeLeaseCount ?? null,
          activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
        });
        return response;
      } catch (error) {
        lastError = error;
        modules.resetNativeAppRegistration();
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.retry-error", {
          reason,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await modules.ensureNativeAppWakeRetryAlarm(true);
    modules.markNativeAppSystemHidingAvailability(false);
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.failed", {
      reason,
      error: lastError instanceof Error ? lastError.message : String(lastError || ""),
    });
    return {
      ok: false,
      error: lastError instanceof Error ? lastError.message : String(lastError || ""),
    };
  }

  Object.assign(modules, {
    runNativeAppWakeRetryInternal,
  });
})();
