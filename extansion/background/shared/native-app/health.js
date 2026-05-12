const NATIVE_APP_HEALTH_TIMEOUT_MS = 1500;

let _nativeAppAvailable = null;
let _lastHealthCheckAt = 0;
const HEALTH_CHECK_CACHE_MS = 30_000;

async function nativeAppHealthCheck(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (!forceRefresh && _nativeAppAvailable !== null && now - _lastHealthCheckAt < HEALTH_CHECK_CACHE_MS) {
    return _nativeAppAvailable;
  }

  try {
    const response = await fetchNativeApp("/health", {
      method: "GET",
      timeoutMs: NATIVE_APP_HEALTH_TIMEOUT_MS,
      skipRegistration: true,
    });

    _nativeAppAvailable = response?.ok === true;
  } catch (_error) {
    _nativeAppAvailable = false;
  }

  _lastHealthCheckAt = now;
  return _nativeAppAvailable;
}

function invalidateNativeAppHealthCache() {
  _nativeAppAvailable = null;
  _lastHealthCheckAt = 0;
}

function isNativeAppAvailableCached() {
  return _nativeAppAvailable === true;
}
