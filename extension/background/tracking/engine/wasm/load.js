const WASM_ENGINE_RETRY_COOLDOWN_MS = 30_000;
let visitGraphEngineLastFailureAt = 0;

async function getVisitGraphEngine() {
  const shouldRetryEngineLoad =
    backgroundState.visitGraphEnginePromise === null &&
    (visitGraphEngineLastFailureAt === 0 ||
      Date.now() - visitGraphEngineLastFailureAt >= WASM_ENGINE_RETRY_COOLDOWN_MS);

  if (shouldRetryEngineLoad) {
    backgroundState.visitGraphEnginePromise = createVisitGraphEngine().catch((error) => {
      console.error("Failed to load visit graph wasm engine.", error);
      visitGraphEngineLastFailureAt = Date.now();
      backgroundState.visitGraphEnginePromise = null;
      return null;
    });
  }

  return backgroundState.visitGraphEnginePromise;
}

// WASM 实例一旦 trap（Rust panic 在 wasm32 上退化成 trap，越界访问、OOM 同理）就被污染：
// 此后对该实例的每次调用都抛 RuntimeError。
//
// getVisitGraphEngine 只在**初次加载失败**的 .catch 里把 promise 置 null，而调用中途的
// trap 走不到那条路径——promise 早已 resolve 成一个看起来可用的包装器。结果是一次 trap
// 就让引擎在整个 service worker 生命周期内失效，而所有调用点都会 catch 后降级到 JS 并
// 只打 console，**没有任何人会发现**。
//
// 这里显式作废实例，让 30 秒冷却重试路径有机会重新实例化，并记一条可观测事件。
// 只对 RuntimeError 生效：包装器对 `{ ok: false }` 这类业务错误抛的是普通 Error，
// 那种情况实例仍然健康，不该作废。
function markVisitGraphEngineTrapped(error) {
  if (!(error instanceof WebAssembly.RuntimeError)) {
    return false;
  }

  visitGraphEngineLastFailureAt = Date.now();
  backgroundState.visitGraphEnginePromise = null;
  globalThis.ZeroLatencyDebugEvents?.record?.("wasm-engine.trapped", {
    message: String(error?.message || error),
  });
  return true;
}

async function createVisitGraphEngine() {
  const response = await fetch(chrome.runtime.getURL(WASM_ENGINE_PATH));

  if (!response.ok) {
    throw new Error(`Wasm engine fetch failed with status ${response.status}.`);
  }

  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());

  if (!instance?.exports?.memory) {
    throw new Error("Wasm engine did not expose linear memory.");
  }

  console.log("Visit graph wasm engine loaded.");
  visitGraphEngineLastFailureAt = 0;
  return wrapVisitGraphEngine(instance.exports);
}
