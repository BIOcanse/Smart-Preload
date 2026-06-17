const nativeAppMissingWarningState = {
  observedAtMs: null,
};

async function noteNativeAppMissingObserved(now = undefined) {
  const nowMs = normalizeWarningNowMs(now);
  const storedObservedAtMs = await readNativeAppMissingObservedAtMs();
  const observedAtMs =
    storedObservedAtMs === null || nowMs < storedObservedAtMs
      ? nowMs
      : storedObservedAtMs;

  if (observedAtMs !== storedObservedAtMs) {
    await writeNativeAppMissingObservedAtMs(observedAtMs);
  }

  return observedAtMs;
}

function normalizeWarningNowMs(value) {
  const normalized = Number(value);
  if (Number.isFinite(normalized) && normalized >= 0) {
    return normalized;
  }

  return Date.now();
}

function normalizeObservedAtMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

async function resetNativeAppModeWarningState() {
  nativeAppMissingWarningState.observedAtMs = null;
  await removeNativeAppMissingObservedAtMs();
}

async function readNativeAppMissingObservedAtMs() {
  const storedValue = await readNativeAppMissingObservedAtMsFromStorage();

  if (storedValue !== null && storedValue !== undefined) {
    const normalized = Number(storedValue);

    if (Number.isFinite(normalized) && normalized >= 0) {
      nativeAppMissingWarningState.observedAtMs = normalized;
      return normalized;
    }
  }

  if (
    nativeAppMissingWarningState.observedAtMs !== null &&
    nativeAppMissingWarningState.observedAtMs !== undefined
  ) {
    const memoryValue = Number(nativeAppMissingWarningState.observedAtMs);

    if (Number.isFinite(memoryValue) && memoryValue >= 0) {
      return memoryValue;
    }
  }

  return null;
}

async function readNativeAppMissingObservedAtMsFromStorage() {
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.get !== "function") {
    return null;
  }

  try {
    const result = await storageArea.get(NATIVE_APP_MISSING_WARNING_STORAGE_KEY);
    return result?.[NATIVE_APP_MISSING_WARNING_STORAGE_KEY] ?? null;
  } catch (_error) {
    return null;
  }
}

async function writeNativeAppMissingObservedAtMs(observedAtMs) {
  nativeAppMissingWarningState.observedAtMs = observedAtMs;
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.set !== "function") {
    return;
  }

  try {
    await storageArea.set({
      [NATIVE_APP_MISSING_WARNING_STORAGE_KEY]: observedAtMs,
    });
  } catch (_error) {
    // Memory fallback is enough when session storage is unavailable.
  }
}

async function removeNativeAppMissingObservedAtMs() {
  const storageArea = getNativeAppMissingWarningStorageArea();

  if (typeof storageArea?.remove !== "function") {
    return;
  }

  try {
    await storageArea.remove(NATIVE_APP_MISSING_WARNING_STORAGE_KEY);
  } catch (_error) {
    // Memory fallback was already cleared by resetNativeAppModeWarningState().
  }
}

function getNativeAppMissingWarningStorageArea() {
  return globalThis.chrome?.storage?.session ?? globalThis.chrome?.storage?.local ?? null;
}
