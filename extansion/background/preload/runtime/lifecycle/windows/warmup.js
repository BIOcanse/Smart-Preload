async function ensureWarmPreloadWindowsForActiveNormalWindows() {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return;
  }

  if (
    (await isExtensionServicePaused()) ||
    !getEffectiveExtensionSettings().preloading.enabled ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() !== true
  ) {
    return;
  }

  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ["normal"],
  });
  const preloadState = await loadPreloadState();
  const runtimeSettings = getEffectiveExtensionSettings();
  let didMutate = false;

  for (const window of windows) {
    const normalWindowId = normalizePositiveInteger(window?.id);

    if (
      normalWindowId === null ||
      isPreloadSentinelWindow(window) ||
      (window.incognito === true &&
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.isIncognitoPreloadExclusionEnabled?.(
          runtimeSettings
        ) === true)
    ) {
      continue;
    }

    const normalWindowRuntime = ensureNormalWindowRuntime(preloadState, normalWindowId);
    const previousPreloadWindowId = normalizePositiveInteger(
      normalWindowRuntime.preloadWindow?.windowId
    );
    const ensuredWindow = await ensurePreloadWindow(preloadState, normalWindowId);
    const nextPreloadWindowId = normalizePositiveInteger(ensuredWindow?.windowId);

    didMutate =
      didMutate ||
      ensuredWindow?.created === true ||
      previousPreloadWindowId !== nextPreloadWindowId;
  }

  if (didMutate) {
    await savePreloadState(preloadState);
  }
}

function isPreloadSentinelWindow(window) {
  return (
    Array.isArray(window?.tabs) &&
    window.tabs.some((tab) => tab?.url === PRELOAD_WINDOW_SENTINEL_URL)
  );
}

globalThis.ensureWarmPreloadWindowsForActiveNormalWindows =
  ensureWarmPreloadWindowsForActiveNormalWindows;
