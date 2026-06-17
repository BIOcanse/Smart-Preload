(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;
  let nativeAppHeartbeatPromise = null;
  let nativeAppWakeRetryPromise = null;
  let lastNativeAppHeartbeatStartedAt = 0;
  let lastNativeAppWakeRetryStartedAt = 0;

  async function sendNativeAppHeartbeat(reason = "alarm") {
    if (nativeAppHeartbeatPromise) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.join-inflight", {
        reason,
      });
      return nativeAppHeartbeatPromise;
    }

    const heartbeatThrottle = modules.getNativeAppAlarmThrottleState(
      reason,
      lastNativeAppHeartbeatStartedAt,
      modules.NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS
    );

    if (heartbeatThrottle.skip) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.skip-throttled", {
        reason,
        elapsedMs: heartbeatThrottle.elapsedMs,
        throttleMs: heartbeatThrottle.throttleMs,
      });
      return {
        ok: false,
        skipped: true,
        reason: "throttled",
        elapsedMs: heartbeatThrottle.elapsedMs,
      };
    }

    if (heartbeatThrottle.alarmDriven) {
      lastNativeAppHeartbeatStartedAt = Date.now();
    }

    nativeAppHeartbeatPromise = sendNativeAppHeartbeatInternal(reason).finally(() => {
      nativeAppHeartbeatPromise = null;
    });

    return nativeAppHeartbeatPromise;
  }

  async function sendNativeAppHeartbeatInternal(reason = "alarm") {
    try {
      const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

      if (browserActivity.normalWindowCount === 0) {
        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.skip-no-normal-window", {
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

      const response = await modules.fetchNativeApp(modules.NATIVE_APP_EXTENSION_HEARTBEAT_PATH, {
        method: "POST",
        body: {
          reason,
          sentAt: new Date().toISOString(),
          ...browserActivity,
        },
        timeoutMs: 1_500,
      });
      modules.markNativeAppSystemHidingAvailability(true);
      await modules.ensureNativeAppWakeRetryAlarm(false);
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.success", {
        reason,
        activeLeaseCount: response?.activeLeaseCount ?? null,
        activeNormalWindowCount: response?.activeNormalWindowCount ?? null,
        normalWindowCount: browserActivity.normalWindowCount ?? null,
      });
      return response;
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.error", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return modules.recoverNativeAppHeartbeat(reason, error);
    }
  }

  async function runNativeAppWakeRetry(reason = "alarm") {
    if (nativeAppWakeRetryPromise) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.join-inflight", {
        reason,
      });
      return nativeAppWakeRetryPromise;
    }

    const wakeRetryThrottle = modules.getNativeAppAlarmThrottleState(
      reason,
      lastNativeAppWakeRetryStartedAt,
      modules.NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS
    );

    if (wakeRetryThrottle.skip) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.wake-retry.skip-throttled", {
        reason,
        elapsedMs: wakeRetryThrottle.elapsedMs,
        throttleMs: wakeRetryThrottle.throttleMs,
      });
      return {
        ok: false,
        skipped: true,
        reason: "throttled",
        elapsedMs: wakeRetryThrottle.elapsedMs,
      };
    }

    if (wakeRetryThrottle.alarmDriven) {
      lastNativeAppWakeRetryStartedAt = Date.now();
    }

    nativeAppWakeRetryPromise = modules.runNativeAppWakeRetryInternal(reason).finally(() => {
      nativeAppWakeRetryPromise = null;
    });

    return nativeAppWakeRetryPromise;
  }

  Object.assign(modules, {
    sendNativeAppHeartbeat,
    runNativeAppWakeRetry,
  });
})();
