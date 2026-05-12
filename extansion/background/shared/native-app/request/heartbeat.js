(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;
  let nativeAppHeartbeatPromise = null;

  async function sendNativeAppHeartbeat(reason = "alarm") {
    if (nativeAppHeartbeatPromise) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.join-inflight", {
        reason,
      });
      return nativeAppHeartbeatPromise;
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
      await ensureNativeAppWakeRetryAlarm(false);
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
      return recoverNativeAppHeartbeat(reason, error);
    }
  }

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
      await wakeNativeAppHostFromHeartbeat(`${reason}:recovery`);
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
        await ensureNativeAppWakeRetryAlarm(false);
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
    await ensureNativeAppWakeRetryAlarm(true);
    return {
      ok: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  async function runNativeAppWakeRetry(reason = "alarm") {
    const browserActivity = await modules.collectNativeAppHeartbeatBrowserActivity();

    if (browserActivity.normalWindowCount === 0) {
      await ensureNativeAppWakeRetryAlarm(false);
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

    if (await probeNativeAppAvailableForWakeRetry()) {
      modules.resetNativeAppRegistration();
      return sendNativeAppHeartbeat(`${reason}:health-ok`);
    }

    let lastError = null;

    try {
      await wakeNativeAppHostFromHeartbeat(`${reason}:wake-retry`);
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
        await ensureNativeAppWakeRetryAlarm(false);
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

    await ensureNativeAppWakeRetryAlarm(true);
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

  async function ensureNativeAppHeartbeatAlarm(enabled) {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
      return;
    }

    if (enabled !== true) {
      await chrome.alarms.clear(modules.NATIVE_APP_HEARTBEAT_ALARM);
      await ensureNativeAppWakeRetryAlarm(false);
      return;
    }

    const periodInMinutes = modules.NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS / 60;
    await chrome.alarms.create(modules.NATIVE_APP_HEARTBEAT_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }

  function isNativeAppHeartbeatAlarm(alarmName) {
    return alarmName === modules.NATIVE_APP_HEARTBEAT_ALARM;
  }

  async function ensureNativeAppWakeRetryAlarm(enabled) {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
      return;
    }

    if (enabled !== true) {
      await chrome.alarms.clear(modules.NATIVE_APP_WAKE_RETRY_ALARM);
      return;
    }

    const periodInMinutes = modules.NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS / 60;
    await chrome.alarms.create(modules.NATIVE_APP_WAKE_RETRY_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }

  function isNativeAppWakeRetryAlarm(alarmName) {
    return alarmName === modules.NATIVE_APP_WAKE_RETRY_ALARM;
  }

  Object.assign(modules, {
    sendNativeAppHeartbeat,
    runNativeAppWakeRetry,
    ensureNativeAppHeartbeatAlarm,
    ensureNativeAppWakeRetryAlarm,
    isNativeAppHeartbeatAlarm,
    isNativeAppWakeRetryAlarm,
  });
})();
