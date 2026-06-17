const preloadWindowEnsurePromisesByNormalWindowId = new Map();

// This file is part of the preload runtime maintenance subsystem under the
// watchdog path. Keep it focused on window ensure/create/commit lifecycle only.

async function ensurePreloadWindow(preloadState, normalWindowId) {
  const normalizedWindowId = normalizePositiveInteger(normalWindowId);

  if (normalizedWindowId === null) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.invalid-window-id", {
      normalWindowId,
    });
    return {
      windowId: null,
      created: false,
      supported: false,
      reason: "invalid-normal-window-id",
    };
  }

  const normalizedWindowKey = String(normalizedWindowId);
  const inFlightPromise = preloadWindowEnsurePromisesByNormalWindowId.get(normalizedWindowKey);

  if (inFlightPromise) {
    return inFlightPromise;
  }

  const ensurePromise = ensurePreloadWindowInternal(preloadState, normalizedWindowId).finally(() => {
    preloadWindowEnsurePromisesByNormalWindowId.delete(normalizedWindowKey);
  });
  preloadWindowEnsurePromisesByNormalWindowId.set(normalizedWindowKey, ensurePromise);
  return ensurePromise;
}

async function ensurePreloadWindowInternal(preloadState, normalWindowId) {
  const ensureContext = await resolvePreloadWindowEnsureContext(normalWindowId);

  if (!ensureContext.ok) {
    return ensureContext.response;
  }

  const normalWindowRuntime = ensureNormalWindowRuntime(preloadState, normalWindowId);
  const existingWindowId = normalWindowRuntime.preloadWindow.windowId;

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.request", {
    normalWindowId,
    existingWindowId: normalizePositiveFiniteNumber(existingWindowId),
    useSystemHiding: ensureContext.useSystemHiding,
    sourceIncognito: ensureContext.sourceWindowIncognito,
  });

  const trackedWindowResult = await tryReuseTrackedPreloadWindow({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    existingWindowId,
    useSystemHiding: ensureContext.useSystemHiding,
    sourceWindowIncognito: ensureContext.sourceWindowIncognito,
  });

  if (trackedWindowResult) {
    return trackedWindowResult;
  }

  const discoveredWindowResult = await tryReuseDiscoveredPreloadWindow({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    useSystemHiding: ensureContext.useSystemHiding,
    sourceWindowIncognito: ensureContext.sourceWindowIncognito,
  });

  if (discoveredWindowResult) {
    return discoveredWindowResult;
  }

  return await createPreloadWindowForRuntime({
    preloadState,
    normalWindowRuntime,
    normalWindowId,
    useSystemHiding: ensureContext.useSystemHiding,
    sourceWindowIncognito: ensureContext.sourceWindowIncognito,
  });
}
