async function enforcePreloadWindowPolicy() {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  if (
    (await isExtensionServicePaused()) ||
    !getEffectiveExtensionSettings().preloading.enabled
  ) {
    return;
  }

  const preloadState = await loadPreloadState();
  let didMutate = false;
  const keepWarmPreloadWindow = shouldKeepWarmPreloadWindow();
  const preloadWindowManager = globalThis.ZeroLatencyPreloadWindowManager;

  for (const normalWindowId of Object.keys(preloadState.normalWindowsById || {})) {
    const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

    if (!normalWindowRuntime) {
      continue;
    }

    if (!hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime)) {
      if (keepWarmPreloadWindow) {
        const ensuredWindow = await preloadWindowManager.ensureWindow(preloadState, normalWindowId);

        if (ensuredWindow.created) {
          didMutate = true;
        }

        const previousHiddenBySystem =
          normalWindowRuntime.preloadWindow.hiddenBySystem === true;
        const previousHwnd = normalWindowRuntime.preloadWindow.hwnd ?? null;
        await preloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
          hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
          hwnd: normalWindowRuntime.preloadWindow.hwnd,
          normalWindowRuntime,
          trigger: "watchdog-warm-window",
        });
        didMutate =
          didMutate ||
          previousHiddenBySystem !==
            (normalWindowRuntime.preloadWindow.hiddenBySystem === true) ||
          previousHwnd !== (normalWindowRuntime.preloadWindow.hwnd ?? null);
        continue;
      }

      if (await preloadWindowManager.closeWindowForNormalWindow(preloadState, normalWindowId)) {
        didMutate = true;
      }

      pruneNormalWindowRuntime(preloadState, normalWindowId);
      continue;
    }

    const ensuredWindow = await preloadWindowManager.ensureWindow(preloadState, normalWindowId);

    if (ensuredWindow.created) {
      didMutate = true;
    }

    const didRepairEntries = await preloadWindowManager.repairEntriesForWindow(
      preloadState,
      Number(normalWindowId),
      ensuredWindow.windowId
    );

    const isHiddenBySystem = normalWindowRuntime.preloadWindow.hiddenBySystem === true;

    const previousHiddenBySystem =
      normalWindowRuntime.preloadWindow.hiddenBySystem === true;
    const previousHwnd = normalWindowRuntime.preloadWindow.hwnd ?? null;
    await preloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
      hiddenBySystem: isHiddenBySystem,
      hwnd: normalWindowRuntime.preloadWindow.hwnd,
      normalWindowRuntime,
      trigger: "watchdog-preload-window",
    });
    didMutate =
      didMutate ||
      previousHiddenBySystem !==
        (normalWindowRuntime.preloadWindow.hiddenBySystem === true) ||
      previousHwnd !== (normalWindowRuntime.preloadWindow.hwnd ?? null);

    if (didRepairEntries) {
      didMutate = true;
    }
  }

  if (await preloadWindowManager.cleanupErroneousWindows(preloadState)) {
    didMutate = true;
  }

  if (didMutate) {
    await savePreloadState(preloadState);
  }
}

async function ensurePreloadWindowWatchdog() {
  const supportApi = globalThis.ZeroLatencySupport;
  const watchdogSupported = supportApi?.supportsPreloadWindowWatchdog?.() === true;
  const runtimeSettings = getEffectiveExtensionSettings();
  const servicePaused = await isExtensionServicePaused();
  const shouldRunWatchdog =
    !servicePaused &&
    runtimeSettings.preloading.enabled &&
    runtimeSettings.preloadWindow.watchdogEnabled &&
    watchdogSupported;

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

function shouldKeepWarmPreloadWindow() {
  return true;
}
