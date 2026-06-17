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

  const periodInMinutes = runtimeSettings.preloadWindow.watchdogIntervalSeconds / 60;
  const cleanupPeriodInMinutes = 1 / 60;

  await chrome.alarms.create(PRELOAD_WINDOW_WATCHDOG_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });

  await chrome.alarms.create(PRELOAD_WINDOW_CLEANUP_ALARM, {
    delayInMinutes: cleanupPeriodInMinutes,
    periodInMinutes: cleanupPeriodInMinutes,
  });
}
