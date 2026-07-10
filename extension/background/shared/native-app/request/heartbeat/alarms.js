(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  async function ensureNativeAppHeartbeatAlarm(enabled) {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
      return;
    }

    if (enabled !== true) {
      await chrome.alarms.clear(modules.NATIVE_APP_HEARTBEAT_ALARM);
      await ensureNativeAppWakeRetryAlarm(false);
      return;
    }

    const periodInMinutes = resolveNativeAppRecurringAlarmPeriodInMinutes(
      modules.NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS
    );
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

    const periodInMinutes = resolveNativeAppRecurringAlarmPeriodInMinutes(
      modules.NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS
    );
    await chrome.alarms.create(modules.NATIVE_APP_WAKE_RETRY_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }

  function isNativeAppWakeRetryAlarm(alarmName) {
    return alarmName === modules.NATIVE_APP_WAKE_RETRY_ALARM;
  }

  function resolveNativeAppRecurringAlarmPeriodInMinutes(intervalSeconds) {
    const seconds = Math.max(
      modules.MIN_PACKED_RECURRING_ALARM_SECONDS,
      Number(intervalSeconds) || 0
    );
    return seconds / 60;
  }

  Object.assign(modules, {
    ensureNativeAppHeartbeatAlarm,
    ensureNativeAppWakeRetryAlarm,
    isNativeAppHeartbeatAlarm,
    isNativeAppWakeRetryAlarm,
    resolveNativeAppRecurringAlarmPeriodInMinutes,
  });
})();
