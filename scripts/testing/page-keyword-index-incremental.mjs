// 关键词倒排索引必须增量更新，不能每写一条就重建整个索引。
//
// 此前 applyRecordPageKeywordsFallback 丢弃整个 byKeyword 并把**整个 pageKeywordStore**
// 重新索引一遍，于是写入 n 条的总代价是 O(n²)。而 pageKeywordStore 按设计无上限增长
// （docs/internal/invariants.md 第 7 条），平方项会随使用时长持续放大。
//
// 本测试同时验证两件事：
//   1. 增量更新的**结果**与全量重建一致（含覆盖写入时旧关键词必须消失）；
//   2. 单次写入的工作量不随 store 规模增长。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const scriptPaths = [
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "tracking", "graph", "indexes", "keywords.js"],
].map((segments) => path.join(repoRoot, ...segments));

// indexPageKeywordEntry / unindexPageKeywordEntry 只依赖这两个工具函数。
function buildContext() {
  const context = {
    console,
    Object,
    Number,
    Math,
    String,
    normalizeKeywordToken: (value) => String(value ?? "").trim().toLowerCase(),
    clampKeywordIndexScore: (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    },
    createEmptyPageKeywordBuckets: () => ({ byKeyword: {} }),
    normalizePageUrlForIndex: (value) => String(value ?? ""),
  };

  context.globalThis = context;
  vm.createContext(context);

  for (const scriptPath of scriptPaths) {
    vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  }

  return context;
}

function entryFor(index, keywords) {
  return {
    pageUrl: `https://site${index}.test/page`,
    keywords: keywords.map((text) => ({ text, score: 1 })),
  };
}

// --- 1. 增量结果与全量重建一致 ---
{
  const context = buildContext();
  const entries = [
    entryFor(0, ["alpha", "beta"]),
    entryFor(1, ["beta", "gamma"]),
    entryFor(2, ["gamma"]),
  ];

  // 增量：逐条索引
  const incremental = { pageKeywordBuckets: context.createEmptyPageKeywordBuckets() };
  for (const entry of entries) {
    context.indexPageKeywordEntry(incremental, entry);
  }

  // 全量：清空后重建（旧实现的做法）
  const rebuilt = { pageKeywordBuckets: context.createEmptyPageKeywordBuckets() };
  for (const entry of entries) {
    rebuilt.pageKeywordBuckets = context.createEmptyPageKeywordBuckets();
    for (const existing of entries.slice(0, entries.indexOf(entry) + 1)) {
      context.indexPageKeywordEntry(rebuilt, existing);
    }
  }

  assert.deepEqual(
    incremental.pageKeywordBuckets,
    rebuilt.pageKeywordBuckets,
    "增量索引的结果与全量重建不一致"
  );
}

// --- 2. 覆盖写入时旧关键词必须消失 ---
{
  const context = buildContext();
  const graph = { pageKeywordBuckets: context.createEmptyPageKeywordBuckets() };
  const before = entryFor(0, ["alpha", "beta"]);
  const after = entryFor(0, ["beta", "delta"]);

  context.indexPageKeywordEntry(graph, before);
  context.unindexPageKeywordEntry(graph, before);
  context.indexPageKeywordEntry(graph, after);

  const byKeyword = graph.pageKeywordBuckets.byKeyword;

  assert.equal(
    byKeyword.alpha,
    undefined,
    "被覆盖掉的旧关键词仍留在倒排索引里 —— 会让该页面在已不含的关键词下被检索到"
  );
  assert.ok(byKeyword.beta?.["https://site0.test/page"], "仍然持有的关键词被误删");
  assert.ok(byKeyword.delta?.["https://site0.test/page"], "新关键词没有被索引");
}

// --- 3. 空桶必须被清理 ---
{
  const context = buildContext();
  const graph = { pageKeywordBuckets: context.createEmptyPageKeywordBuckets() };
  const entry = entryFor(0, ["solo"]);

  context.indexPageKeywordEntry(graph, entry);
  assert.ok(graph.pageKeywordBuckets.byKeyword.solo);

  context.unindexPageKeywordEntry(graph, entry);
  assert.equal(
    graph.pageKeywordBuckets.byKeyword.solo,
    undefined,
    "空关键词桶没有被清理 —— 倒排表会堆积只剩空对象的键"
  );
}

// --- 4. 单次写入的工作量不随 store 规模增长 ---
//
// 用「索引函数触碰的关键词次数」而不是墙钟时间来度量，避免测试受机器负载影响。
{
  const context = buildContext();
  let touchedKeywords = 0;
  const originalNormalize = context.normalizeKeywordToken;
  context.normalizeKeywordToken = (value) => {
    touchedKeywords += 1;
    return originalNormalize(value);
  };

  const graph = { pageKeywordBuckets: context.createEmptyPageKeywordBuckets() };

  // 先灌 200 条，模拟一个已经积累起来的 store。
  for (let index = 0; index < 200; index += 1) {
    context.indexPageKeywordEntry(graph, entryFor(index, ["shared", `unique${index}`]));
  }

  // 再写一条，量它的工作量。
  touchedKeywords = 0;
  context.indexPageKeywordEntry(graph, entryFor(999, ["shared", "unique999"]));
  const costOnLargeStore = touchedKeywords;

  assert.equal(
    costOnLargeStore,
    2,
    `单次写入触碰了 ${costOnLargeStore} 个关键词 —— 应当只等于该条目自身的关键词数(2)，` +
      "说明写入代价仍与 store 规模相关（旧实现是 O(store)，总代价 O(n²)）"
  );
}

console.log(JSON.stringify({ ok: true, checks: 4 }, null, 2));
