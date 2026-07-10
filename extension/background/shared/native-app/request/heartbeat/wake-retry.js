(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function runNativeAppWakeRetryInternal(reason = "alarm") {
    const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

    if (browserActivity.normalWindowCount === 0) {
      const releaseResult = await modules.sendNativeAppHeartbeatNow(
        `${reason}:lease-release`,
        { allowRecovery: false }
      );
      globalThis.ZeroLatencyDebugEvents?.record?.(
        "native-app.wake-retry.release-no-normal-window",
        {
          reason,
          normalTabCount: browserActivity.normalTabCount ?? 0,
        }
      );
      return releaseResult;
    }

    if (await modules.probeNativeAppAvailableForWakeRetry()) {
      modules.resetNativeAppRegistration();
      return modules.sendNativeAppHeartbeatNow(`${reason}:health-ok`, {
        allowRecovery: false,
      });
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

    try {
      modules.resetNativeAppRegistration();
      const response = await modules.sendNativeAppHeartbeatNow(
        `${reason}:wake-retry-recovered`,
        { allowRecovery: false }
      );

      if (response?.ok === false) {
        throw new Error(response.error || "native app heartbeat remained unavailable.");
      }

      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.success", {
        reason,
        activeLeaseCount: response?.activeLeaseCount ?? null,
        activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
      });
      return response;
    } catch (error) {
      lastError = error;
      modules.resetNativeAppRegistration();
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
