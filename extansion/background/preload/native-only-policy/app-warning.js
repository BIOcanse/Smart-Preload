async function buildNativeAppModeWarning(settings = resolveCurrentNativeOnlySettings(), options = {}) {
  const nowMs = normalizeWarningNowMs(options.now);

  if (
    !isNativeAppMissingWarningRelevant(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() === true
  ) {
    await resetNativeAppModeWarningState();
    return {
      active: false,
    };
  }

  const observedAtMs = await noteNativeAppMissingObserved(nowMs);
  return buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs);
}

function peekNativeAppModeWarning(settings = resolveCurrentNativeOnlySettings(), options = {}) {
  const nowMs = normalizeWarningNowMs(options.now);

  if (
    !isNativeAppMissingWarningRelevant(settings) ||
    globalThis.ZeroLatencySupport?.isSystemLevelWindowHidingUsable?.() === true
  ) {
    nativeAppMissingWarningState.observedAtMs = null;
    return {
      active: false,
    };
  }

  const observedAtMs = normalizeObservedAtMs(nativeAppMissingWarningState.observedAtMs);

  if (observedAtMs === null) {
    return {
      active: false,
      reason: "native-app-warning-cache-unavailable",
    };
  }

  return buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs);
}

function buildNativeAppModeWarningFromObservedAt(observedAtMs, nowMs) {
  const elapsedMs = Math.max(0, nowMs - observedAtMs);

  if (elapsedMs < NATIVE_APP_MISSING_WARNING_DELAY_MS) {
    return {
      active: false,
      pending: true,
      reason: "native-app-unavailable-pending",
      observedAtMs,
      delayMs: NATIVE_APP_MISSING_WARNING_DELAY_MS,
      remainingMs: NATIVE_APP_MISSING_WARNING_DELAY_MS - elapsedMs,
    };
  }

  return {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback: NATIVE_APP_MISSING_WARNING_FALLBACK,
    observedAtMs,
    delayMs: NATIVE_APP_MISSING_WARNING_DELAY_MS,
  };
}

async function handleSystemLevelWindowHidingUsabilityChange(usable, options = {}) {
  const settings = options.settings ?? resolveCurrentNativeOnlySettings();

  if (usable === true || !isNativeAppMissingWarningRelevant(settings)) {
    await resetNativeAppModeWarningState();
    return;
  }

  await noteNativeAppMissingObserved(options.now);
}

function isNativeAppMissingWarningRelevant(settings = resolveCurrentNativeOnlySettings()) {
  return (
    settings?.preloading?.enabled === true &&
    isRealPreloadEnabled(settings) &&
    globalThis.ZeroLatencySupport?.supportsSystemLevelWindowHiding?.() === true
  );
}
