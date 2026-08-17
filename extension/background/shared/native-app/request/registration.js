(function () {
  const modules = globalThis.ZeroLatencyNativeAppRequestModules;
  let nativeAppRegistrationPromise = null;
  let pairingBackoffUntil = 0;

  // 用户拒绝配对（或 app 侧还在冷却期）后的静默期。
  //
  // app 收到未配对的注册请求会弹确认框，而**拒绝按产品口径不落盘**——下次还会问。
  // 心跳和唤醒重试都是 30 秒一次，两个定时器一叠加，用户被同一个弹窗半分钟砸一次
  // （实测 94 秒 7 次）。这里让扩展自己闭嘴：被拒后不再跟着定时器试。
  //
  // 取 10 分钟，比 app 侧的 5 分钟冷却长——两边都失效时才会回到刷屏，
  // 而扩展这一侧是主动方，应当更保守。
  const PAIRING_REJECTED_BACKOFF_MS = 10 * 60 * 1000;

  // 退避截止时刻必须落盘，**不能只放模块变量**。
  //
  // 两个原因，第二个是实测踩出来的（2026-08-09）：
  //   1. MV3 的 service worker 空闲约 30 秒被回收，而心跳闹钟正好 30 秒一次 ——
  //      模块变量大概率撑不过一个周期。
  //   2. `resetNativeAppRegistration()` 被心跳恢复与唤醒重试**自动**调用（六处），
  //      早先版本在那里顺手清了退避，于是退避每个周期都被抹掉，从未生效。
  //
  // 用 session 而不是 local：浏览器重启后重新问一次是合理的，
  // 而且不该在磁盘上留下一条看起来像「永久拒绝」的记录。
  const PAIRING_BACKOFF_STORAGE_KEY = "nativeAppPairingBackoffUntil";

  async function readPairingBackoffUntil() {
    if (pairingBackoffUntil > 0) {
      return pairingBackoffUntil;
    }

    try {
      const stored = await globalThis.chrome?.storage?.session?.get?.(
        PAIRING_BACKOFF_STORAGE_KEY
      );
      const value = Number(stored?.[PAIRING_BACKOFF_STORAGE_KEY]);
      pairingBackoffUntil = Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_error) {
      // 读不到就当没有退避：本地 app 的连通性不该因为存储抖动而永久断掉。
      pairingBackoffUntil = 0;
    }

    return pairingBackoffUntil;
  }

  async function beginPairingBackoff() {
    pairingBackoffUntil = Date.now() + PAIRING_REJECTED_BACKOFF_MS;

    try {
      await globalThis.chrome?.storage?.session?.set?.({
        [PAIRING_BACKOFF_STORAGE_KEY]: pairingBackoffUntil,
      });
    } catch (_error) {
      // 写不进去只会退化成「只在当前 SW 实例内有效」，不影响正确性。
    }
  }

  async function isPairingBackoffActive() {
    const until = await readPairingBackoffUntil();

    if (until <= 0) {
      return false;
    }

    if (Date.now() < until) {
      return true;
    }

    await clearNativeAppPairingBackoff();
    return false;
  }

  // ⚠️ 这个函数必须**同步**给 `nativeAppRegistrationPromise` 赋值。
  //
  // 退避检查要读 session 存储，是异步的。如果在赋值之前 await 它，两个并发调用会双双
  // 看到 `null`、双双 await、然后各自发一次注册请求 —— 一次性合并就没了，
  // 用户可能因此被弹两次。所以 await 全部塞进 `registerUnlessBackedOff()` 里面。
  function ensureNativeAppRegistration() {
    if (nativeAppRegistrationPromise) {
      return nativeAppRegistrationPromise;
    }

    nativeAppRegistrationPromise = registerUnlessBackedOff().catch((error) => {
      nativeAppRegistrationPromise = null;
      throw error;
    });

    return nativeAppRegistrationPromise;
  }

  async function registerUnlessBackedOff() {
    if (await isPairingBackoffActive()) {
      // 直接抛，不发请求 —— 发了就是又一个弹窗。
      throw new Error("native app pairing was declined; waiting before asking again");
    }

    return fetchNativeAppRegistrationOnce();
  }

  async function fetchNativeAppRegistrationOnce() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), modules.NATIVE_APP_REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.start", {
      timeoutMs: modules.NATIVE_APP_REQUEST_TIMEOUT_MS,
    });

    try {
      const response = await fetch(
        `${modules.NATIVE_APP_BASE_URL}${modules.NATIVE_APP_EXTENSION_REGISTER_PATH}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: modules.buildNativeAppHeaders(),
        }
      );

      if (!response.ok) {
        // 403 = app 明确不放行：用户点了「不连接」、形状预筛没过、或还在 app 侧冷却期。
        //       三种都不该按定时器重试 —— 第一种会再弹一次弹窗，后两种重试也不会有别的结果。
        //
        // 409 = **确认框正开着等用户**，这不是拒绝。绝不能进长退避：用户点完「连接」之后，
        //       得靠接下来的重试才能真正连上；退避十分钟的话，用户会觉得点了没反应。
        //       保持原样（短间隔重试）即可，app 侧的并发闸保证不会因此多弹窗。
        //
        // 其它状态码（app 刚起来还没就绪等）也保持原样重试。
        if (response.status === 403) {
          await beginPairingBackoff();
        }

        globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.fail", {
          status: response.status,
          durationMs: Date.now() - startedAt,
          backoffMs: response.status === 403 ? PAIRING_REJECTED_BACKOFF_MS : 0,
          pairingPending: response.status === 409,
        });
        throw new Error(`native app registration responded with ${response.status}`);
      }

      const payload = await response.json();
      modules.markNativeAppSystemHidingAvailability(true);
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.success", {
        durationMs: Date.now() - startedAt,
        allowedOrigin: payload?.allowedOrigin || null,
      });
      return payload;
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.registration.error", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        aborted: controller.signal.aborted,
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 丢掉缓存的注册结果，让下次调用重新走一遍。
  //
  // ⚠️ 这是**自动恢复**用的：心跳恢复与唤醒重试共六处会调它，每个周期都可能触发。
  // 所以它**绝不能碰配对退避** —— 碰了退避就等于没有（早先版本正是这么写的，
  // 实测每 30 秒照样重试一次，退避从未生效）。
  // 用户主动要求连接时走 `clearNativeAppPairingBackoff()`。
  function resetNativeAppRegistration() {
    nativeAppRegistrationPromise = null;
  }

  // 用户主动动作才调这个（在设置页保存设置、刚装好扩展等）。
  // 用户主动要求连接时，不该还被自己十分钟前的拒绝挡着。
  async function clearNativeAppPairingBackoff() {
    pairingBackoffUntil = 0;

    try {
      await globalThis.chrome?.storage?.session?.remove?.(PAIRING_BACKOFF_STORAGE_KEY);
    } catch (_error) {
      // 内存里已经清了，落盘失败最多让退避在本次会话里多留一会儿。
    }
  }

  Object.assign(modules, {
    ensureNativeAppRegistration,
    resetNativeAppRegistration,
    clearNativeAppPairingBackoff,
    PAIRING_REJECTED_BACKOFF_MS,
    PAIRING_BACKOFF_STORAGE_KEY,
  });
})();
