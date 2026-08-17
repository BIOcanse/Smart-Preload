// stableStringifyPreloadSelectionValue 改成显式栈后，输出必须与手写递归版**逐字一致**。
//
// 它是 buildPreloadSelectionFingerprint 的一部分，用于判断预加载选择是否变化。输出变一个
// 字节就会造成一次虚假的「已变更」，进而触发不必要的重新同步。
//
// 手写递归版没有深度上限，且与 JSON.stringify 不同 —— 遇到环不抛 TypeError 而是直接栈溢出。
// 当前输入是调度器自建的固定形状对象，所以那不是活缺陷；改造是为遵守「禁递归」约定。
//
// 特意**不**改用 JSON.stringify + replacer：那条路在两处会给出不同结果 ——
// 对象里的 undefined 被原生省略（手写版输出 `"key":null`），带 toJSON 的对象（Date）
// 被原生展开成字符串（手写版按普通对象枚举得到 `{}`）。本测试把这两种输入都纳入语料。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../extension/background/preload/scheduler/runtime-sync.js", import.meta.url),
  "utf8"
);

const sandbox = { console, JSON, Object, Array, Set, Map, Math, Number, String, Boolean, Date };
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
vm.runInContext(source, context, { filename: "runtime-sync.js" });

const stableStringify = context.stableStringifyPreloadSelectionValue;
assert.equal(typeof stableStringify, "function");

// --- oracle：改造前的手写递归实现，逐字保留 ---
function stringifyViaRecursion(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stringifyViaRecursion).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stringifyViaRecursion(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

// --- 语料：覆盖真实输入形状 + 与 replacer 方案分道扬镳的那两种输入 ---
const corpus = [
  null,
  undefined,
  0,
  -0,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  true,
  false,
  "",
  "plain",
  'quotes " and \\ backslash',
  "换行\n与制表\t",
  [],
  {},
  [1, 2, 3],
  [null, undefined, NaN],
  { b: 1, a: 2, c: 3 },
  { z: { y: { x: { w: 1 } } } },
  { key: undefined },
  { key: () => 1 },
  [() => 1],
  { when: new Date(0) },
  [new Date(0)],
  { nested: [{ b: 1, a: [2, { d: 4, c: 3 }] }] },
  // buildPreloadSelectionFingerprint 实际传入的形状
  {
    bookmarkPreload: null,
    scoreBreakdown: { transition: 0.5, ai: 0.25, bookmark: 0 },
    transitionMetrics: { total: 12, recent: 3, lastSeenAt: "2026-08-01T00:00:00.000Z" },
    aiKeywordMatch: { matched: true, keywords: ["alpha", "beta"], score: 0.8 },
    realPreloadSafety: { blocked: false, reasons: [] },
    siteSelection: { limit: 4, nodeId: "site:example.test" },
  },
  {
    bookmarkPreload: { index: 3, title: "Docs" },
    scoreBreakdown: null,
    transitionMetrics: null,
    aiKeywordMatch: null,
    realPreloadSafety: null,
    siteSelection: null,
  },
];

for (const [index, value] of corpus.entries()) {
  assert.equal(
    stableStringify(value),
    stringifyViaRecursion(value),
    `语料 #${index} 的序列化结果与手写递归版不一致：${JSON.stringify(String(value))}`
  );
}

// --- 键排序必须与插入顺序无关（fingerprint 的全部意义所在）---
{
  const forward = { alpha: 1, beta: 2, gamma: 3 };
  const reverse = { gamma: 3, beta: 2, alpha: 1 };

  assert.equal(
    stableStringify(forward),
    stableStringify(reverse),
    "插入顺序改变了指纹 —— 稳定序列化失效"
  );
  assert.equal(stableStringify(forward), '{"alpha":1,"beta":2,"gamma":3}');
}

// --- 深层结构不得栈溢出 ---
{
  const DEPTH = 20_000;
  let deep = 1;

  for (let index = 0; index < DEPTH; index += 1) {
    deep = { nested: deep };
  }

  let recursionOverflowed = false;
  try {
    stringifyViaRecursion(deep);
  } catch (error) {
    recursionOverflowed = error instanceof RangeError;
  }
  assert.ok(recursionOverflowed, `深度 ${DEPTH} 没有压垮手写递归版，夹具需要加深`);

  const output = stableStringify(deep);
  assert.equal(typeof output, "string", "超深结构应当产出字符串而不是抛异常");
  assert.ok(output.startsWith('{"nested":'), "超深结构的前缀应当正常");
  assert.ok(output.includes("null"), "触顶处应当退化为 null");
}

// --- 环必须终止（手写版在这里会栈溢出）---
{
  const cyclic = { name: "loop" };
  cyclic.self = cyclic;

  const output = stableStringify(cyclic);
  assert.equal(
    output,
    '{"name":"loop","self":null}',
    "成环时应当把回边写成 null 并正常收尾"
  );
}

// --- 同一个对象出现在兄弟位置不算环，必须完整展开两次 ---
{
  const shared = { a: 1 };
  const output = stableStringify({ left: shared, right: shared });

  assert.equal(
    output,
    '{"left":{"a":1},"right":{"a":1}}',
    "共享引用被误判成环 —— 只有祖先链上的重复才是环"
  );
  assert.equal(output, stringifyViaRecursion({ left: shared, right: shared }));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        `${corpus.length} corpus values match the recursive oracle byte for byte`,
        "key order does not depend on insertion order",
        "deep structures that overflow recursion produce output",
        "cycles terminate instead of overflowing",
        "shared sibling references are not mistaken for cycles",
      ],
    },
    null,
    2
  )
);
