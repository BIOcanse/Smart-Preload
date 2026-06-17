(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function recoverNativeAppHeartbeat(reason, firstError) {
    modules.resetNativeAppRegistration();
    invalidateNativeAppHealthCache?.();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-start", {
      reason,
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });

    const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

    if (browserActivity.normalWindowCount === 0) {
      globalThis.ZeroLatencyDebugEvents?.record?.(
        "native-app.heartbeat.recovery-skip-no-normal-window",
        {
          reason,
          normalTabCount: browserActivity.normalTabCount ?? 0,
        }
      );
      return {
        ok: false,
        skipped: true,
        reason: "no-normal-window",
        normalWindowCount: 0,
      };
    }

    try {
      await modules.wakeNativeAppHostFromHeartbeat(`${reason}:recovery`);
    } catch (wakeError) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-wake-error", {
        reason,
        error: wakeError instanceof Error ? wakeError.message : String(wakeError),
      });
    }

    let lastError = firstError;

    for (const delayMs of modules.NATIVE_APP_HEARTBEAT_RECOVERY_DELAYS_MS) {
      await wait(delayMs);

      try {
        await modules.ensureNativeAppRegistration();
        const response = await modules.fetchNativeApp(modules.NATIVE_APP_EXTENSION_HEARTBEAT_PATH, {
          method: "POST",
          body: {
            reason: `${reason}:recovered`,
            sentAt: new Date().toISOString(),
            ...browserActivity,
          },
          timeoutMs: 1_500,
        });
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-success", {
          reason,
          activeLeaseCount: response?.activeLeaseCount ?? null,
          activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
        });
        modules.markNativeAppSystemHidingAvailability(true);
        await modules.ensureNativeAppWakeRetryAlarm(false);
        return response;
      } catch (error) {
        lastError = error;
        modules.resetNativeAppRegistration();
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-retry-error", {
          reason,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-failed", {
      reason,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    modules.markNativeAppSystemHidingAvailability(false);
    await modules.ensureNativeAppWakeRetryAlarm(true);
    return {
      ok: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  Object.assign(modules, {
    recoverNativeAppHeartbeat,
  });
})();
