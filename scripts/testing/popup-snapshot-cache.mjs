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
  ["extension", "background", "tracking", "url", "google.js"],
  ["extension", "background", "tracking", "url", "network.js"],
  ["extension", "background", "tracking", "url", "model.js"],
  ["extension", "background", "tracking", "graph", "model", "schema.js"],
  ["extension", "background", "tracking", "view.js"],
  ["extension", "background", "preload", "state", "model.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "window.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "metadata.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "scores.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "preloads.js"],
  ["extension", "background", "preload", "state", "normalize", "entries.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime.js"],
  ["extension", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extension", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extension", "background", "preload", "state", "view.js"],
  ["extension", "background", "core", "messages", "debug", "warnings.js"],
  ["extension", "background", "core", "messages", "debug", "history-deletion.js"],
  ["extension", "background", "core", "messages", "debug.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
};
context.globalThis = context;
context.getEffectiveExtensionSettings = () => ({
  tracking: {
    excludeGoogleInternalPages: true,
  },
});
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

let fullTrackingStateLoads = 0;
let fullPreloadStateLoads = 0;
context.loadTrackingState = async () => {
  fullTrackingStateLoads += 1;
  throw new Error("popup snapshot must not load full tracking state");
};
context.loadPreloadState = async () => {
  fullPreloadStateLoads += 1;
  throw new Error("popup snapshot must not load full preload state");
};
context.loadTrackingSnapshotForPopup = async () => ({
  summary: {
    version: 13,
    nodeCount: 4,
    edgeCount: 7,
    transitionMessageCount: 2,
    updatedAt: "2026-06-01T12:00:00.000Z",
    transitionSequence: 9,
    learning: {
      pageKeywordCount: 1,
      recentForegroundPageCount: 1,
      historyPagePoolSize: 1,
    },
  },
  tabState: {
    101: {
      nodeId: "https://source.example",
      url: "https://source.example/page",
      updatedAt: "2026-06-01T12:00:00.000Z",
    },
  },
  preloadState: {
    version: 2,
    normalWindowsById: {
      1: {
        normalWindowId: 1,
        preloadWindow: {
          windowId: 999,
          hwnd: 12345,
          hiddenBySystem: true,
        },
        sourceTabs: {
          101: {
            sourceTabId: 101,
            hiddenTabEntriesByUrl: {},
            prerenderEntriesByUrl: {
              "https://target.example/high": {
                requestedUrl: "https://target.example/high",
                score: 12,
                status: "ready",
              },
            },
            prefetchEntriesByUrl: {},
          },
        },
      },
    },
    scheduler: context.createEmptyPreloadSchedulerState(),
  },
  serviceState: {
    paused: false,
    bookmarkPreloading: {
      startupGoogleSearchTabId: null,
      startupGoogleSearchWindowId: null,
    },
    updatedAt: "2026-06-01T12:00:00.000Z",
  },
});

const snapshot = await context.ZeroLatencyCoreDebugMessages.handleDebugSnapshot({
  mode: "popup",
  tabId: 101,
  pageUrl: "https://source.example/page",
});

assert.equal(fullTrackingStateLoads, 0);
assert.equal(fullPreloadStateLoads, 0);
assert.equal(snapshot.mode, "popup");
assert.equal(snapshot.summary.nodeCount, 4);
assert.equal(snapshot.pageContext.preloadWindowHwnd, 12345);
assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.currentTopTargets.map((target) => target.requestedUrl))),
  ["https://target.example/high"]
);

console.log("popup snapshot cache tests passed");
