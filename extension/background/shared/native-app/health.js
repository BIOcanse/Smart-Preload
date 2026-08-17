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

    // `/health` 在 app 侧是**受 origin 网关保护**的：只有已配对的扩展才拿得到 200。
    // 所以探测成功本身就证明「我们已经被授权了」，此时任何配对退避都没有意义了。
    //
    // 这条是托盘手动配对的回环：用户从托盘把这个扩展配上之后，app 没有办法主动通知
    // 扩展；没有这里的清除，扩展会在自己的十分钟退避里干等，用户会以为点了没生效。
    // 健康探测用的是 skipRegistration，退避期内照常运行，所以这条路一定走得通。
    if (_nativeAppAvailable === true) {
      await globalThis.ZeroLatencyNativeAppRequestModules?.clearNativeAppPairingBackoff?.();
    }
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
