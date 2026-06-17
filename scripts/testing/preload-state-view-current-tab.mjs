import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "tracking", "url", "google.js"],
  ["extansion", "background", "tracking", "url", "network.js"],
  ["extansion", "background", "tracking", "url", "model.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "view.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
  getEffectiveExtensionSettings: () => ({
    tracking: {
      trackGoogleSearchPages: true,
      excludeGoogleInternalPages: true,
    },
  }),
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const preloadState = context.createEmptyPreloadState();
const currentRuntime = context.ensureSourceTabRuntime(preloadState, 10, 101).sourceTabRuntime;
const otherRuntime = context.ensureSourceTabRuntime(preloadState, 10, 202).sourceTabRuntime;

currentRuntime.hiddenTabEntriesByUrl["https://current.example/low"] = buildHiddenEntry({
  requestedUrl: "https://current.example/low",
  score: 2,
});
currentRuntime.hiddenTabEntriesByUrl["https://current.example/high"] = buildHiddenEntry({
  requestedUrl: "https://current.example/high",
  score: 10,
});
currentRuntime.prerenderEntriesByUrl["https://current.example/prerender"] =
  buildSyntheticEntry({
    requestedUrl: "https://current.example/prerender",
    score: 8,
    status: "ready",
  });
currentRuntime.prefetchEntriesByUrl["https://current.example/prefetch"] = buildSyntheticEntry({
  requestedUrl: "https://current.example/prefetch",
  score: 3,
  status: "ready",
});
otherRuntime.hiddenTabEntriesByUrl["https://other.example/highest"] = buildHiddenEntry({
  requestedUrl: "https://other.example/highest",
  score: 999,
});

const currentTopTargets = context.buildCurrentPreloads(preloadState, 101);

assert.deepEqual(
  JSON.parse(JSON.stringify(currentTopTargets.map((target) => target.requestedUrl))),
  [
    "https://current.example/high",
    "https://current.example/prerender",
    "https://current.example/prefetch",
  ]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(currentTopTargets.map((target) => target.score))),
  [10, 8, 3]
);
assert.equal(
  currentTopTargets.some((target) => target.requestedUrl.includes("other.example")),
  false
);
assert.deepEqual(JSON.parse(JSON.stringify(context.buildCurrentPreloads(preloadState, 303))), []);

console.log("preload state view current tab tests passed");

function buildHiddenEntry({ requestedUrl, score }) {
  return {
    requestedUrl,
    loadedUrl: requestedUrl,
    score,
    nodeId: new URL(requestedUrl).origin,
    status: "complete",
  };
}

function buildSyntheticEntry({ requestedUrl, score, status }) {
  return {
    requestedUrl,
    score,
    status,
  };
}
