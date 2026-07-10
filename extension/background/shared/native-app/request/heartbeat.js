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

    const runHeartbeat = () => {
      if (nativeAppHeartbeatPromise) {
        return nativeAppHeartbeatPromise;
      }

      nativeAppHeartbeatPromise = sendNativeAppHeartbeatInternal(reason).finally(() => {
        nativeAppHeartbeatPromise = null;
      });
      return nativeAppHeartbeatPromise;
    };

    return typeof globalThis.queueLifecycle === "function"
      ? globalThis.queueLifecycle("native-app-heartbeat", runHeartbeat)
      : runHeartbeat();
  }

  async function sendNativeAppHeartbeatInternal(reason = "alarm", options = {}) {
    const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

    try {
      return await postNativeAppHeartbeat(reason, browserActivity);
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.error", {
        reason,
        error: error instanceof Error ? error.message : String(error),
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

      if (options.allowRecovery === false) {
        modules.markNativeAppSystemHidingAvailability(false);
        await modules.ensureNativeAppWakeRetryAlarm(true);
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      return modules.recoverNativeAppHeartbeat(reason, error, browserActivity);
    }
  }

  async function postNativeAppHeartbeat(reason, browserActivity) {
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

    const runWakeRetry = () => {
      if (nativeAppWakeRetryPromise) {
        return nativeAppWakeRetryPromise;
      }

      nativeAppWakeRetryPromise = modules.runNativeAppWakeRetryInternal(reason).finally(() => {
        nativeAppWakeRetryPromise = null;
      });
      return nativeAppWakeRetryPromise;
    };

    return typeof globalThis.queueLifecycle === "function"
      ? globalThis.queueLifecycle("native-app-wake-retry", runWakeRetry)
      : runWakeRetry();
  }

  Object.assign(modules, {
    sendNativeAppHeartbeat,
    sendNativeAppHeartbeatNow: sendNativeAppHeartbeatInternal,
    postNativeAppHeartbeat,
    runNativeAppWakeRetry,
  });
})();
