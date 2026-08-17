import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scripts = [
  ["extension", "background", "shared", "native-app", "request", "common.js"],
  ["extension", "background", "shared", "native-app", "request", "registration.js"],
].map((segments) => path.join(repoRoot, ...segments));
let fetchCount = 0;
let rejectFetch;
const blockedFetch = new Promise((_resolve, reject) => {
  rejectFetch = reject;
});
const context = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Date,
  fetch: async () => {
    fetchCount += 1;
    return blockedFetch;
  },
  chrome: { runtime: { id: "a".repeat(32) } },
  ZeroLatencyDebugEvents: { record: () => {} },
  ZeroLatencySupport: {
    supportsSystemLevelWindowHiding: () => false,
  },
};
context.globalThis = context;
vm.createContext(context);

for (const script of scripts) {
  vm.runInContext(readFileSync(script, "utf8"), context, { filename: script });
}

const modules = context.ZeroLatencyNativeAppRequestModules;
const first = modules.ensureNativeAppRegistration();
const joined = modules.ensureNativeAppRegistration();

// 「合并」直接用 promise 同一性来断言，不靠数微任务。
//
// 原先这里是 `await Promise.resolve(); assert.equal(fetchCount, 1)` —— 用「一个 tick 之后
// 已经发了一次请求」当合并的代理指标。配对退避检查引入了一次 session 存储读取之后，
// fetch 会晚几个微任务才开始，这条断言就开始因为时序而失败，而合并本身是好的。
// 同一性断言更强也更稳：它同时排除了「第二次调用覆盖了第一次的 promise」这种真回归。
assert.equal(first, joined, "并发调用必须共用同一次注册，否则会向 app 发两次注册请求");

// 排空微任务队列，让退避检查走完、fetch 真正发出。
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetchCount, 1, "两个并发调用各发了一次请求 —— 用户可能因此被弹两次确认框");

rejectFetch(new Error("offline"));
await assert.rejects(first, /offline/);
await assert.rejects(joined, /offline/);

context.fetch = async () => {
  fetchCount += 1;
  throw new Error("still offline");
};
await assert.rejects(modules.ensureNativeAppRegistration(), /still offline/);
assert.equal(fetchCount, 2);

console.log("native app registration one-shot tests passed");
