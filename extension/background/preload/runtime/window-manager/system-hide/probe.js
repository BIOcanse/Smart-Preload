const SYSTEM_HIDING_REPROBE_INTERVAL_MS = 10_000;
let lastSystemHidingReprobeAt = 0;
let systemHidingReprobePromise = null;

async function resolveSystemHidingUsableForPreloadWindow() {
  const supportApi = globalThis.ZeroLatencySupport;

  if (supportApi?.isSystemLevelWindowHidingUsable?.() === true) {
    return true;
  }

  if (supportApi?.supportsSystemLevelWindowHiding?.() !== true) {
    return false;
  }

  const now = Date.now();
  if (now - lastSystemHidingReprobeAt < SYSTEM_HIDING_REPROBE_INTERVAL_MS) {
    return false;
  }

  if (!systemHidingReprobePromise) {
    lastSystemHidingReprobeAt = now;
    systemHidingReprobePromise = supportApi
      .probeNativeAppAvailability?.({ forceRefresh: true })
      .catch(() => false)
      .finally(() => {
        systemHidingReprobePromise = null;
      });
  }

  return (await systemHidingReprobePromise) === true;
}
