import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const runtimeSyncPath = path.join(
  repoRoot,
  "extension",
  "background",
  "preload",
  "scheduler",
  "runtime-sync.js"
);
const appliedSourceTabIds = [];
const context = {
  console,
  JSON,
  Number,
  Object,
  globalThis: null,
  findSourceTabRuntime(preloadState, sourceTabId) {
    return preloadState.sourceTabs?.[String(sourceTabId)]
      ? {
          normalWindowId: 10,
          sourceTabRuntime: preloadState.sourceTabs[String(sourceTabId)],
        }
      : null;
  },
  getSourceTabPreloadChannelStore(sourceRuntime, channel) {
    return sourceRuntime[channel] ?? {};
  },
  ZeroLatencyPreloadDiff: {
    async applySourceTabSelection({ preloadState, sourceTabId, selection }) {
      appliedSourceTabIds.push(sourceTabId);
      const sourceRuntime = preloadState.sourceTabs[String(sourceTabId)];
      sourceRuntime.hiddenTab = Object.fromEntries(
        selection.selectedTargets
          .filter((target) => target.strategy === "hidden-tab")
          .map((target) => [target.url, { requestedUrl: target.url, ...target }])
      );
      return preloadState;
    },
  },
  ZeroLatencyDebugEvents: { record: () => {} },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(runtimeSyncPath, "utf8"), context, {
  filename: runtimeSyncPath,
});

const preloadState = {
  sourceTabs: {
    1: {
      hiddenTab: {
        "https://same.example/": {
          requestedUrl: "https://same.example/",
          nodeId: "same",
          score: 10,
          strategy: "hidden-tab",
          targetHint: "_blank",
        },
      },
      prerender: {},
      prefetch: {},
    },
    2: {
      hiddenTab: {
        "https://old.example/": {
          requestedUrl: "https://old.example/",
          nodeId: "old",
          score: 5,
          strategy: "hidden-tab",
        },
      },
      prerender: {},
      prefetch: {},
    },
  },
};
const scheduledSelections = [
  buildScheduledSelection(1, "https://same.example/", "same", 10),
  buildScheduledSelection(2, "https://new.example/", "new", 8),
];

const result = await context.synchronizeChangedScheduledPreloadSelections(
  preloadState,
  scheduledSelections
);

assert.deepEqual(appliedSourceTabIds, [2]);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(result.changedSelections.map((selection) => selection.sourceTabId))
  ),
  [2]
);

const movedSelection = buildScheduledSelection(1, "https://same.example/", "same", 10);
movedSelection.sourceWindowId = 20;
const movedResult = await context.synchronizeChangedScheduledPreloadSelections(
  preloadState,
  [movedSelection]
);
assert.deepEqual(appliedSourceTabIds, [2, 1]);
assert.equal(movedResult.changedSelections.length, 1);

console.log("preload scheduler changed sync tests passed");

function buildScheduledSelection(sourceTabId, url, nodeId, score) {
  const target = {
    strategy: "hidden-tab",
    url,
    nodeId,
    score,
    targetHint: "_blank",
  };
  return {
    sourceTabId,
    sourceWindowId: 10,
    sourcePageUrl: `https://source.example/${sourceTabId}`,
    nativeSlots: 0,
    tabSlots: 1,
    selection: {
      selectedTargets: [target],
      tabTargets: [target],
      prerenderTargets: [],
      prefetchTargets: [],
    },
  };
}
