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
await Promise.resolve();
assert.equal(fetchCount, 1);

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
