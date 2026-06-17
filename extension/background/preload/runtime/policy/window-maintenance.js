async function maintainPreloadWindowsForWatchdog(preloadState, preloadWindowManager) {
  let didMutate = false;

  for (const normalWindowId of Object.keys(preloadState.normalWindowsById || {})) {
    const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

    if (!normalWindowRuntime) {
      continue;
    }

    if (
      await maintainSinglePreloadWindowForWatchdog(
        preloadState,
        preloadWindowManager,
        normalWindowId,
        normalWindowRuntime
      )
    ) {
      didMutate = true;
    }
  }

  if (await preloadWindowManager.cleanupErroneousWindows(preloadState)) {
    didMutate = true;
  }

  return didMutate;
}

async function maintainSinglePreloadWindowForWatchdog(
  preloadState,
  preloadWindowManager,
  normalWindowId,
  normalWindowRuntime
) {
  let didMutate = false;
  const liveNormalWindow = await getWindowMaybe(Number(normalWindowId));

  if (liveNormalWindow?.type !== "normal") {
    if (await preloadWindowManager.closeWindowForNormalWindow(preloadState, normalWindowId)) {
      didMutate = true;
    }

    pruneNormalWindowRuntime(preloadState, normalWindowId);
    return true;
  }

  if (!hasHiddenPreloadEntriesForNormalWindow(normalWindowRuntime)) {
    return await maintainPreloadWindowWithoutHiddenEntriesForWatchdog(
      preloadState,
      preloadWindowManager,
      normalWindowId,
      normalWindowRuntime
    );
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

  if (
    await maintainPreloadWindowHiddenStateForWatchdog(
      preloadWindowManager,
      ensuredWindow.windowId,
      normalWindowRuntime,
      "watchdog-preload-window"
    )
  ) {
    didMutate = true;
  }

  if (didRepairEntries) {
    didMutate = true;
  }

  return didMutate;
}

async function maintainPreloadWindowWithoutHiddenEntriesForWatchdog(
  preloadState,
  preloadWindowManager,
  normalWindowId,
  normalWindowRuntime
) {
  if (shouldKeepWarmPreloadWindow(normalWindowRuntime)) {
    const ensuredWindow = await preloadWindowManager.ensureWindow(preloadState, normalWindowId);
    const didMaintainHiddenState = await maintainPreloadWindowHiddenStateForWatchdog(
      preloadWindowManager,
      ensuredWindow.windowId,
      normalWindowRuntime,
      "watchdog-warm-window"
    );

    return ensuredWindow.created === true || didMaintainHiddenState;
  }

  let didMutate = false;

  if (await preloadWindowManager.closeWindowForNormalWindow(preloadState, normalWindowId)) {
    didMutate = true;
  }

  pruneNormalWindowRuntime(preloadState, normalWindowId);
  return didMutate;
}

async function maintainPreloadWindowHiddenStateForWatchdog(
  preloadWindowManager,
  preloadWindowId,
  normalWindowRuntime,
  trigger
) {
  const previousHiddenBySystem = normalWindowRuntime.preloadWindow.hiddenBySystem === true;
  const previousHwnd = normalWindowRuntime.preloadWindow.hwnd ?? null;
  const previousSystemHideSignature = getPreloadWindowSystemHideSignature(
    normalWindowRuntime.preloadWindow
  );
  await preloadWindowManager.maintainHiddenState(preloadWindowId, {
    hiddenBySystem: normalWindowRuntime.preloadWindow.hiddenBySystem === true,
    hwnd: normalWindowRuntime.preloadWindow.hwnd,
    normalWindowRuntime,
    trigger,
  });

  return (
    previousHiddenBySystem !==
      (normalWindowRuntime.preloadWindow.hiddenBySystem === true) ||
    previousHwnd !== (normalWindowRuntime.preloadWindow.hwnd ?? null) ||
    previousSystemHideSignature !==
      getPreloadWindowSystemHideSignature(normalWindowRuntime.preloadWindow)
  );
}

function shouldKeepWarmPreloadWindow(normalWindowRuntime) {
  if (globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() !== true) {
    return false;
  }

  return !isPreloadWindowSystemHideBackoffActive(normalWindowRuntime?.preloadWindow);
}

function getPreloadWindowSystemHideSignature(preloadWindowState) {
  if (!preloadWindowState || typeof preloadWindowState !== "object") {
    return "";
  }

  return JSON.stringify({
    hiddenBySystem: preloadWindowState.hiddenBySystem === true,
    hwnd: normalizePositiveFiniteNumber(preloadWindowState.hwnd),
    systemHideFailureCount: clampNonNegativeInt(preloadWindowState.systemHideFailureCount, 0),
    systemHideDisabledUntil: normalizePositiveFiniteNumber(
      preloadWindowState.systemHideDisabledUntil
    ),
    lastSystemHideError:
      typeof preloadWindowState.lastSystemHideError === "string"
        ? preloadWindowState.lastSystemHideError
        : null,
    lastSystemHideFailedAt:
      typeof preloadWindowState.lastSystemHideFailedAt === "string"
        ? preloadWindowState.lastSystemHideFailedAt
        : null,
  });
}
