(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;

  function getNativeAppAlarmThrottleState(reason, lastStartedAt, intervalSeconds) {
    const alarmDriven = isNativeAppAlarmDrivenReason(reason);
    const throttleMs = Math.max(1_000, Math.floor((Number(intervalSeconds) || 0) * 1_000 * 0.8));
    const elapsedMs = lastStartedAt > 0 ? Date.now() - lastStartedAt : null;

    return {
      alarmDriven,
      throttleMs,
      elapsedMs,
      skip: alarmDriven && elapsedMs !== null && elapsedMs < throttleMs,
    };
  }

  function isNativeAppAlarmDrivenReason(reason) {
    return String(reason || "alarm") === "alarm";
  }

  Object.assign(modules, {
    getNativeAppAlarmThrottleState,
    isNativeAppAlarmDrivenReason,
  });
})();
