(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function recoverNativeAppHeartbeat(reason, firstError, browserActivity) {
    modules.resetNativeAppRegistration();
    globalThis.invalidateNativeAppHealthCache?.();
    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-start", {
      reason,
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });

    if (browserActivity.normalWindowCount === 0) {
      await modules.ensureNativeAppWakeRetryAlarm(false);
      return {
        ok: false,
        skipped: true,
        reason: "lease-release-offline",
        normalWindowCount: 0,
      };
    }

    let lastError = firstError;

    try {
      await modules.wakeNativeAppHostFromHeartbeat(`${reason}:recovery`);
    } catch (wakeError) {
      lastError = wakeError;
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-wake-error", {
        reason,
        error: wakeError instanceof Error ? wakeError.message : String(wakeError),
      });
    }

    try {
      modules.resetNativeAppRegistration();
      const response = await modules.postNativeAppHeartbeat(
        `${reason}:recovered`,
        browserActivity
      );
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.recovery-success", {
        reason,
        activeLeaseCount: response?.activeLeaseCount ?? null,
        activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
      });
      return response;
    } catch (error) {
      lastError = error;
      modules.resetNativeAppRegistration();
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
