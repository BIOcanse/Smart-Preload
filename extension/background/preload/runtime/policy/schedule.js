async function ensurePreloadWindowWatchdog() {
  const supportApi = globalThis.ZeroLatencySupport;
  const watchdogSupported = supportApi?.supportsPreloadWindowWatchdog?.() === true;
  const runtimeSettings = getEffectiveExtensionSettings();
  const servicePaused = await isExtensionServicePaused();
  const pressurePolicy = resolvePreloadFullscreenPressurePolicy(runtimeSettings);
  const shouldRunWatchdog =
    !servicePaused &&
    runtimeSettings.preloading.enabled &&
    watchdogSupported &&
    (runtimeSettings.preloadWindow.watchdogEnabled || pressurePolicy !== "ignore");

  if (!shouldRunWatchdog) {
    if (supportApi?.hasChromeNamespaceMethod?.("alarms", "clear") === true) {
      await chrome.alarms.clear(PRELOAD_WINDOW_WATCHDOG_ALARM);
      await chrome.alarms.clear(PRELOAD_WINDOW_CLEANUP_ALARM);
    }
    return;
  }

  const minimumRecurringAlarmSeconds = 30;
  const periodInMinutes =
    Math.max(
      minimumRecurringAlarmSeconds,
      Number(runtimeSettings.preloadWindow.watchdogIntervalSeconds) || 0
    ) / 60;
  const cleanupPeriodInMinutes = minimumRecurringAlarmSeconds / 60;

  await chrome.alarms.create(PRELOAD_WINDOW_WATCHDOG_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });

  await chrome.alarms.create(PRELOAD_WINDOW_CLEANUP_ALARM, {
    delayInMinutes: cleanupPeriodInMinutes,
    periodInMinutes: cleanupPeriodInMinutes,
  });
}
