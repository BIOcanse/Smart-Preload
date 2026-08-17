// checkpoint 归一化戳：冷启动跳过对「自己刚写出去的数据」的防御性再校验。
//
// normalizeTrackingGraph 的两条原有路径都是 O(图规模)，而且所谓的「快路径」只比全量重建
// 便宜 15-20% —— 它剩下的工作（逐条 normalizeEdgeRecord、normalizeLinkBehaviorStore、
// normalizePageKeywordStore…）全是在校验扩展自己刚落盘的数据。实测（预热 + 中位数）：
//
//   节点数    盖戳(新)     snapshot    全量重建
//     500     0.009 ms     9.4 ms      12.7 ms
//    2000     0.055 ms    38.9 ms      46.3 ms
//    8000     0.064 ms   164.0 ms     199.5 ms
//   20000     0.053 ms   438.1 ms     554.4 ms
//
// 学习图按 invariants 第 7 条无上限增长，而这笔开销在**每次 service worker 冷启动**上、
// 跑在唯一的线程里。盖戳把它从 O(图规模) 变成 O(1)。
//
// 换来的风险有两条，本测试各钉一条：
//   - 损坏的存储不再被自动修复 → 形状检查仍然保留，戳只能证明「谁写的」；
//   - **导入的备份带着戳就能绕过重建** → format.js 必须连戳一起清掉。
//     第二条是安全性的：备份里的 bucket 结构是调用方提供的任意数据。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const manifestSource = readFileSync("extension/service-worker-scripts.js", "utf8");
const manifestContext = vm.createContext({ globalThis: {} });
vm.runInContext(manifestSource, manifestContext);
const scripts = Array.from(
  manifestContext.globalThis.ZERO_LATENCY_SERVICE_WORKER_SCRIPTS,
  String
);
const bundle = scripts.map((p) => readFileSync(`extension/${p}`, "utf8")).join("\n\n");

let manifestVersion = "9.9.9";

const sandbox = {
  console,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  structuredClone,
  setTimeout,
  clearTimeout,
  crypto,
  Date,
  // 这三个由 service-worker.js 顶层声明，而那个文件不在打包清单里 —— bundle 并非自足。
  BUCKET_PRIMARY_CHARSET: "abcdefghijklmnopqrstuvwxyz0123456789_",
  BUCKET_SECONDARY_BLANK_INDEX: 37,
  OUTBOUND_BUCKET_COUNT: 37 * 38,
  chrome: {
    runtime: {
      getManifest: () => ({ version: manifestVersion }),
    },
  },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(bundle, context, { filename: "bundle.js" });

const { normalizeTrackingGraph, createEmptyGraph, buildTrackingGraphNormalizationStamp } = context;
assert.equal(typeof normalizeTrackingGraph, "function");
assert.equal(typeof buildTrackingGraphNormalizationStamp, "function");

function buildStoredGraph({ stamped }) {
  const graph = createEmptyGraph();
  const now = "2026-08-01T00:00:00.000Z";

  graph.nodes["site:a.test"] = {
    nodeId: "site:a.test",
    host: "a.test",
    sampleUrl: "https://a.test/page",
    defaultLandingPageUrl: "https://a.test/page",
    visitCount: 3,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  graph.persistenceMode = "incremental-checkpoint-v1";

  if (stamped) {
    graph.normalizedBy = buildTrackingGraphNormalizationStamp();
  }

  return graph;
}

// --- 1. 盖了本版本的戳 + 形状正常 → 原样返回，不做任何工作 ---
{
  const stored = buildStoredGraph({ stamped: true });
  // 塞一个归一化会抹掉的标记：原样返回时它必须还在。
  stored.__untouchedProbe = "kept";

  const result = normalizeTrackingGraph(stored);

  assert.equal(result, stored, "戳命中时应当原样返回同一个对象");
  assert.equal(
    result.__untouchedProbe,
    "kept",
    "戳命中却仍然重建了 —— O(图规模) 的开销没省下来"
  );
}

// --- 2. 换个扩展版本 → 戳失配，必须重新归一化 ---
{
  const stored = buildStoredGraph({ stamped: true });
  manifestVersion = "9.9.10";

  const result = normalizeTrackingGraph(stored);

  assert.equal(
    result.normalizedBy,
    undefined,
    "版本变了却仍然信任旧戳 —— 同一 schema 下的代码改动（比如某个 normalize 修了 bug）" +
      "就再也不会作用到旧数据上"
  );
  manifestVersion = "9.9.9";
}

// --- 3. 盖了戳但形状损坏 → 不得走快路径，损坏必须自愈 ---
{
  const stored = buildStoredGraph({ stamped: true });
  // 模拟写入被截断：索引数组变成了别的类型。
  stored.transitionMessageBuckets = { buckets: "truncated" };

  const result = normalizeTrackingGraph(stored);

  assert.ok(
    Array.isArray(result.transitionMessageBuckets?.buckets),
    "形状损坏时仍走了快路径 —— 戳只能证明「谁写的」，证明不了「写完没被截断」"
  );
  assert.equal(result.normalizedBy, undefined, "真干活的路径必须清掉旧戳");
}

// --- 4. 【安全】导入的备份不得借戳绕过重建 ---
//
// 备份里的 transitionMessageBuckets / pageTransitionMessageBuckets 是**调用方提供的任意
// 结构**。历史导入靠强制全量重建把它们整体换成本机新建的空对象。
//
// 这里先证明**这个形状本来是能命中快路径的**（否则断言是空的：全量重建路径自己也会清戳，
// 不清 format.js 那行照样看不出区别），再证明导入路径仍然把它重建了。
//
// 今天有两道各自独立够用的闸：`delete persistenceMode`（形状检查过不了）与
// `delete normalizedBy`（戳对不上）。两道都留着 —— 将来若有人放宽形状检查，
// 只剩戳那一道时它必须还在。
{
  const format = context.ZeroLatencyTrackingHistoryTransferFormat;
  assert.ok(format, "没取到历史备份模块");

  function buildHostileGraph() {
    const graph = buildStoredGraph({ stamped: true });
    // 攻击者可控的桶结构。正常情况下会被 normalize 整体替换成新建的空对象。
    graph.transitionMessageBuckets = { buckets: [{ hostile: ["marker"] }] };
    graph.version = 14;
    return graph;
  }

  // 前置证明：这个形状确实能命中快路径。
  const fastPathProbe = buildHostileGraph();
  assert.equal(
    normalizeTrackingGraph(fastPathProbe),
    fastPathProbe,
    "夹具本身命不中快路径 —— 那么下面的断言证明不了导入路径挡住了什么"
  );
  assert.equal(
    JSON.stringify(fastPathProbe.transitionMessageBuckets).includes("hostile"),
    true,
    "快路径命中时敌意桶结构应当原样留着 —— 这正是必须挡住导入的原因"
  );

  const backup = {
    format: format.HISTORY_BACKUP_FORMAT,
    formatVersion: format.HISTORY_BACKUP_FORMAT_VERSION,
    exportedAt: "2026-08-01T00:00:00.000Z",
    extensionVersion: "9.9.9",
    history: { graph: buildHostileGraph() },
  };

  const parsed = format.parseHistoryBackup(backup);

  assert.equal(
    JSON.stringify(parsed.graph.transitionMessageBuckets).includes("hostile"),
    false,
    "备份里的桶结构没有被重建 —— 导入路径被归一化戳绕过了"
  );
  assert.equal(
    parsed.graph.normalizedBy,
    undefined,
    "导入后的图仍带着归一化戳 —— 下次冷启动会直接信任它"
  );
}

// --- 5. 冷启动的完整往返：归一化 → 盖戳 → 再归一化命中快路径 ---
//
// 戳由 pruneTrackingGraphHistory 在 checkpoint 落盘时盖上，这里直接调它，
// 验证「写出去的东西下次读回来确实能命中」。
{
  const first = normalizeTrackingGraph(buildStoredGraph({ stamped: false }));
  assert.equal(first.normalizedBy, undefined, "还没落盘就不该有戳");

  // 模拟 checkpoint 落盘时的盖戳。
  first.version = 14;
  first.persistenceMode = "incremental-checkpoint-v1";
  first.normalizedBy = buildTrackingGraphNormalizationStamp();
  first.__untouchedProbe = "kept";

  const second = normalizeTrackingGraph(first);
  assert.equal(second, first, "落盘盖戳后再读回来应当命中快路径");
  assert.equal(second.__untouchedProbe, "kept");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "a stamped, well-shaped graph is returned untouched",
        "a different extension version invalidates the stamp",
        "a corrupted shape still falls back to full normalization",
        "history import cannot bypass the rebuild with a stamp (security)",
        "checkpoint stamp round-trips into a fast-path hit",
      ],
    },
    null,
    2
  )
);
