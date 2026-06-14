let _systemHidingUsable = false;

function isSystemLevelWindowHidingUsable() {
  return _systemHidingUsable;
}

function setSystemLevelWindowHidingUsable(value) {
  _systemHidingUsable = value === true;
  try {
    const warningChangeHandler =
      globalThis.ZeroLatencyPreloadNativeOnlyPolicy
        ?.handleSystemLevelWindowHidingUsabilityChange;

    if (typeof warningChangeHandler === "function") {
      void Promise.resolve(warningChangeHandler(_systemHidingUsable)).catch(() => {});
    }
  } catch (_error) {
    // Support state updates must never be blocked by warning bookkeeping.
  }
}

async function probeNativeAppAvailability(options = {}) {
  if (!supportsSystemLevelWindowHiding()) {
    setSystemLevelWindowHidingUsable(false);
    return false;
  }

  const forceRefresh = options.forceRefresh !== false;
  const available = await nativeAppHealthCheck({ forceRefresh });
  setSystemLevelWindowHidingUsable(available);
  return available;
}
