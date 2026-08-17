// WASM 实例 trap 之后必须能恢复，而不是在整个 service worker 生命周期内静默降级。
//
// getVisitGraphEngine 只在**初次加载失败**的 .catch 里把 promise 置 null。调用中途的
// trap 走不到那条路径——promise 早已 resolve 成一个看起来可用的包装器。没有显式作废时，
// 一次 trap 就让引擎永久失效，而所有调用点都会 catch 后降级到 JS 并只打 console，
// 没有任何人会发现。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const loadPath = path.join(
  repoRoot,
  "extension",
  "background",
  "tracking",
  "engine",
  "wasm",
  "load.js"
);

function buildContext({ engineFactory }) {
  const debugEvents = [];
  // 冷却计时用的 visitGraphEngineLastFailureAt 是 load.js 顶层的 `let`，而顶层 let 不会
  // 成为 globalThis 属性，测试无法从外部改它。所以改用可控时钟推进时间。
  const clock = { now: 1_000_000 };
  const controllableDate = {
    now: () => clock.now,
  };
  const context = {
    console: { log() {}, error() {} },
    clock,
    Date: controllableDate,
    WebAssembly,
    String,
    debugEvents,
    WASM_ENGINE_PATH: "wasm/pkg/visit_graph_engine.wasm",
    backgroundState: { visitGraphEnginePromise: null },
    // load.js 里 createVisitGraphEngine 会 fetch + instantiate，这里整体替换掉：
    // 本测试关心的是 trap 之后的实例作废与重建，不是加载过程。
    wrapVisitGraphEngine: () => engineFactory(),
    chrome: { runtime: { getURL: (value) => value } },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
  };

  context.globalThis = context;
  context.ZeroLatencyDebugEvents = {
    record: (eventName, payload) => {
      debugEvents.push({ eventName, payload });
    },
  };

  vm.createContext(context);
  vm.runInContext(readFileSync(loadPath, "utf8"), context, { filename: loadPath });

  // instantiate 无法在 Node 里用假 buffer 走通，直接替换 createVisitGraphEngine。
  context.createVisitGraphEngine = async () => {
    context.visitGraphEngineLastFailureAt = 0;
    return context.wrapVisitGraphEngine();
  };

  return context;
}

// 场景 1：trap（WebAssembly.RuntimeError）必须作废实例并留下可观测事件
{
  let instanceCount = 0;
  const context = buildContext({
    engineFactory: () => {
      instanceCount += 1;
      return { id: instanceCount };
    },
  });

  const first = await context.getVisitGraphEngine();
  assert.ok(first, "首次加载应当返回实例");
  assert.equal(instanceCount, 1);

  const trapped = context.markVisitGraphEngineTrapped(
    new WebAssembly.RuntimeError("unreachable executed")
  );

  assert.equal(trapped, true, "RuntimeError 未被识别为 trap");
  assert.equal(
    context.backgroundState.visitGraphEnginePromise,
    null,
    "trap 之后实例没有被作废 —— 引擎会在整个 service worker 生命周期内静默降级"
  );
  assert.equal(
    context.debugEvents.at(-1)?.eventName,
    "wasm-engine.trapped",
    "trap 没有留下可观测事件"
  );
}

// 场景 2：普通业务错误（{ ok: false } 抛的 Error）不得作废实例
{
  const context = buildContext({ engineFactory: () => ({ id: 1 }) });
  await context.getVisitGraphEngine();
  const promiseBefore = context.backgroundState.visitGraphEnginePromise;

  const trapped = context.markVisitGraphEngineTrapped(
    new Error("Wasm scoring returned an unknown error.")
  );

  assert.equal(trapped, false, "普通 Error 被误判成 trap");
  assert.equal(
    context.backgroundState.visitGraphEnginePromise,
    promiseBefore,
    "普通业务错误不应作废实例 —— 那会把健康的引擎白白丢掉"
  );
}

// 场景 3：作废之后受 30 秒冷却约束，冷却期内不重建，冷却期满后重建
{
  let instanceCount = 0;
  const context = buildContext({
    engineFactory: () => {
      instanceCount += 1;
      return { id: instanceCount };
    },
  });

  await context.getVisitGraphEngine();
  assert.equal(instanceCount, 1);

  context.markVisitGraphEngineTrapped(new WebAssembly.RuntimeError("trap"));

  // 冷却期内：不重建，返回 null（调用方据此走 JS 降级）
  const duringCooldown = await context.getVisitGraphEngine();
  assert.equal(duringCooldown, null, "冷却期内不应返回实例");
  assert.equal(instanceCount, 1, "冷却期内不应重建实例");

  // 时钟推进 31 秒，模拟冷却期满
  context.clock.now += 31_000;
  const afterCooldown = await context.getVisitGraphEngine();

  assert.ok(afterCooldown, "冷却期满后应当重建实例");
  assert.equal(instanceCount, 2, "冷却期满后没有真正重建");
}

console.log(JSON.stringify({ ok: true, scenarios: 3 }, null, 2));
