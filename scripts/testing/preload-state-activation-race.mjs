// 复现并锁定 interaction lane 的激活路径对 preloadState 的丢更新。
//
// preloadState 的读改写纪律是「整个 load…save 必须在一个 queueMutation 任务内完成」
// （见 docs/internal/invariants.md 第 1 条）。激活路径此前不遵守：preloadState 在
// activation/resolution.js:12 的轮询循环里加载，返回后要经过真实的标签激活、临时标签
// 关闭、窗口聚焦，最后才在 activation/cleanup.js 保存——这中间 mutation lane 的任何
// 写入都会被这份陈旧快照整体覆盖掉。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const activationRoot = path.join(
  repoRoot,
  "extension",
  "background",
  "preload",
  "runtime",
  "activation"
);
// state-mutation.js 提供 applySourceTabPreloadMutation，cleanup.js 的写入全部经它。
const scriptPaths = ["state-mutation.js", "cleanup.js"].map((name) =>
  path.join(activationRoot, name)
);

function buildStore() {
  return {
    normalWindowsById: {
      10: {
        sourceTabs: {
          1: {
            hiddenTabEntriesByUrl: {
              "https://target.test/a": { tabId: 501, requestedUrl: "https://target.test/a" },
              "https://target.test/b": { tabId: 502, requestedUrl: "https://target.test/b" },
            },
          },
        },
      },
    },
  };
}

function buildContext(store) {
  const saves = [];
  // 真实的串行队列，语义与 core/state/queues/serial.js 一致。
  let tail = Promise.resolve();

  const context = {
    console,
    Promise,
    Object,
    Number,
    Date,
    JSON,
    saves,
    async loadPreloadState() {
      // 与生产实现一致：每次都重读，返回独立副本。
      return structuredClone(store.value);
    },
    async savePreloadState(preloadState) {
      saves.push(structuredClone(preloadState));
      store.value = structuredClone(preloadState);
    },
    queueMutation(task) {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    },
    getSourceTabRuntimeForWindow(preloadState, normalWindowId, sourceTabId) {
      const sourceTabRuntime =
        preloadState?.normalWindowsById?.[normalWindowId]?.sourceTabs?.[sourceTabId];
      return sourceTabRuntime ? { sourceTabRuntime } : null;
    },
    deleteSourceTabPreloadEntry(sourceTabRuntime, _channel, targetUrl) {
      delete sourceTabRuntime?.hiddenTabEntriesByUrl?.[targetUrl];
    },
    pruneSourceTabRuntime() {},
    async clearPreloadsForSourceTab(preloadState, normalWindowId, sourceTabId) {
      const sourceTabRuntime =
        preloadState?.normalWindowsById?.[normalWindowId]?.sourceTabs?.[sourceTabId];

      if (sourceTabRuntime) {
        sourceTabRuntime.hiddenTabEntriesByUrl = {};
      }

      return preloadState;
    },
    markSourceRuntimeUpdated() {},
    closeTabIfExists: async () => {},
    globalThis: null,
  };

  context.globalThis = context;
  vm.createContext(context);
  for (const scriptPath of scriptPaths) {
    vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  }
  return context;
}

function entriesOf(state) {
  return Object.keys(state?.normalWindowsById?.[10]?.sourceTabs?.[1]?.hiddenTabEntriesByUrl || {});
}

// 场景 1：clearStaleActivationEntry 不得覆盖并发写入
{
  const store = { value: buildStore() };
  const context = buildContext(store);

  // interaction lane 在很早的时候拿到一份快照（模拟 resolution.js:12 的加载）。
  const staleSnapshot = await context.loadPreloadState();
  const staleRuntimeEntry = context.getSourceTabRuntimeForWindow(staleSnapshot, 10, 1);

  // 这期间 mutation lane 写入了别的东西（标签事件、watchdog、调度……）。
  const concurrent = await context.loadPreloadState();
  concurrent.concurrentMarker = "written-by-mutation-lane";
  await context.savePreloadState(concurrent);

  // interaction lane 才走到保存。
  await context.clearStaleActivationEntry({
    preloadState: staleSnapshot,
    sourceRuntimeEntry: staleRuntimeEntry,
    sourceTab: { id: 1, windowId: 10 },
    sourceTabId: 1,
    targetUrl: "https://target.test/a",
    entry: { tabId: 501 },
  });

  assert.equal(
    store.value.concurrentMarker,
    "written-by-mutation-lane",
    "陈旧快照覆盖了 mutation lane 的并发写入（丢更新）"
  );
  assert.deepEqual(
    entriesOf(store.value),
    ["https://target.test/b"],
    "语义动作没有正确施加：应当只删掉 /a"
  );
}

// 场景 2：clearSourceTabPreloadsAfterActivation **仍然**会覆盖并发写入 —— 已知未修。
//
// 这条不是回归护栏，而是把一个已知缺口钉在这里，防止有人以为它已经修好了。
// 不修的原因（两条都经 click-intercept-navigation-smoke 实测确认）：
//   1. clearPreloadsForSourceTab 内部逐条 `await closeTabIfExists`，搬进 mutation lane
//      等于让真实关标签操作占住临界区。
//   2. 它的语义「清空除激活项外的全部预加载」依赖求值时机；用最新状态执行会把调度器
//      在这期间新建的预加载一并清掉——实测 preloadedBeforeClick 从 9 掉到 0-1。
// 正确做法是把动作降级为「删除快照里那批具体 URL」并把关标签移出临界区，属独立改动。
{
  const store = { value: buildStore() };
  const context = buildContext(store);

  const staleSnapshot = await context.loadPreloadState();

  const concurrent = await context.loadPreloadState();
  concurrent.concurrentMarker = "written-by-mutation-lane";
  await context.savePreloadState(concurrent);

  await context.clearSourceTabPreloadsAfterActivation({
    preloadState: staleSnapshot,
    sourceTab: { id: 1, windowId: 10 },
    sourceTabId: 1,
    activatedTab: { id: 501 },
  });

  assert.equal(
    store.value.concurrentMarker,
    undefined,
    "这条已知缺口被修好了 —— 请更新本测试与 docs/internal/invariants.md 第 1 条"
  );
  assert.deepEqual(entriesOf(store.value), [], "语义动作没有正确施加：应当清空该 source tab");
}

// 场景 3：source tab 在重读后已消失时不得抛错
{
  const store = { value: buildStore() };
  const context = buildContext(store);

  const staleSnapshot = await context.loadPreloadState();
  const staleRuntimeEntry = context.getSourceTabRuntimeForWindow(staleSnapshot, 10, 1);

  // mutation lane 把整个 source tab 移除了（标签关闭）。
  const concurrent = await context.loadPreloadState();
  delete concurrent.normalWindowsById[10].sourceTabs[1];
  await context.savePreloadState(concurrent);

  await context.clearStaleActivationEntry({
    preloadState: staleSnapshot,
    sourceRuntimeEntry: staleRuntimeEntry,
    sourceTab: { id: 1, windowId: 10 },
    sourceTabId: 1,
    targetUrl: "https://target.test/a",
    entry: { tabId: 501 },
  });

  assert.equal(
    store.value.normalWindowsById[10].sourceTabs[1],
    undefined,
    "已被并发移除的 source tab 又被陈旧快照写了回去"
  );
}

console.log(JSON.stringify({ ok: true, scenarios: 3 }, null, 2));
