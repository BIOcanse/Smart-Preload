import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(
  [
    "../../extension/background/preload/runtime/source-tabs/channels.js",
    "../../extension/background/preload/runtime/activation/target.js",
    // safety.js 的写入经 applySourceTabPreloadMutation，定义在这里。
    "../../extension/background/preload/runtime/activation/state-mutation.js",
    "../../extension/background/preload/runtime/activation/safety.js",
    "../../extension/background/preload/runtime/activation/incognito.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const debugEvents = [];
const closedTabs = [];
let savedPreloadState = null;
let storedPreloadState = null;
let prunedRuntime = null;
let updatedRuntime = null;

const contextObject = {
  console,
  Date,
  Number,
  String,
  normalizePageUrlForIndex: (url) =>
    typeof url === "string" && url.startsWith("https://") ? url : "",
  isTrackableAndAllowedUrl: (url) =>
    typeof url === "string" && url.startsWith("https://"),
  closeTabIfExists: async (tabId) => {
    closedTabs.push(tabId);
  },
  markSourceRuntimeUpdated: (preloadState, sourceRuntimeEntry, updatedAt) => {
    updatedRuntime = { preloadState, sourceRuntimeEntry, updatedAt };
  },
  pruneSourceTabRuntime: (preloadState, windowId, sourceTabId) => {
    prunedRuntime = { preloadState, windowId, sourceTabId };
  },
  savePreloadState: async (preloadState) => {
    savedPreloadState = preloadState;
    storedPreloadState = preloadState;
  },
  // 激活路径的写入现在经 applySourceTabPreloadMutation：进 mutation lane、重读最新
  // 状态、重新定位 source tab runtime、施加语义动作后再保存。所以这里要提供
  // queueMutation / loadPreloadState / getSourceTabRuntimeForWindow 三个桩。
  // 见 docs/internal/invariants.md 第 1 条。
  queueMutation: (task) => task(),
  loadPreloadState: async () => storedPreloadState,
  getSourceTabRuntimeForWindow: (preloadState, normalWindowId, sourceTabId) =>
    preloadState?.normalWindowsById?.[normalWindowId]?.sourceTabs?.[sourceTabId] ?? null,
  getWindowMaybe: async (windowId) => ({
    id: windowId,
    incognito: windowId === 9,
  }),
};
contextObject.globalThis = contextObject;
contextObject.ZeroLatencyDebugEvents = {
  record: (eventName, payload) => {
    debugEvents.push({ eventName, payload });
  },
};
contextObject.ZeroLatencyPreloadSafetyPolicy = {
  inspectPreloadCandidate: () => ({
    realPreloadBlocked: true,
    reason: "download-link",
    reasons: ["download-link"],
  }),
};
contextObject.ZeroLatencyPreloadIncognitoPolicy = {
  resolveSourceTargetIncognitoMatch: (sourceTab, preloadedTab, destinationWindow) => {
    if (destinationWindow?.incognito === true) {
      return {
        matches: false,
        sourceIncognito: sourceTab?.incognito === true,
        targetIncognito: true,
      };
    }

    return {
      matches: preloadedTab?.incognito !== true,
      sourceIncognito: sourceTab?.incognito === true,
      targetIncognito: preloadedTab?.incognito === true,
    };
  },
};

const context = vm.createContext(contextObject);
for (const [index, source] of sources.entries()) {
  vm.runInContext(source, context, {
    filename: `preload-activation-helper-${index}.js`,
  });
}

assert.equal(
  context.resolveActivatedTrackingTargetUrl(
    "https://requested.example/",
    { url: "about:blank" },
    { loadedUrl: "https://loaded.example/" }
  ),
  "https://loaded.example/"
);
assert.equal(
  context.resolveActivatedTrackingTargetUrl(
    "https://requested.example/",
    { url: "https://tab.example/" },
    { loadedUrl: "https://loaded.example/" }
  ),
  "https://tab.example/"
);

// blockUnsafePreloadedActivationIfNeeded 不再保存调用方手上的快照，而是在 mutation lane
// 上重读最新状态、重新定位 source tab runtime、再施加删除动作。因此这里断言的是
// **存储里的最新状态**被正确修改，而不是某个传入对象的同一性。
storedPreloadState = {
  updatedAt: "",
  normalWindowsById: {
    4: {
      sourceTabs: {
        3: {
          sourceTabRuntime: {
            hiddenTabEntriesByUrl: {
              "https://download.example/file.zip": { tabId: 42 },
            },
          },
        },
      },
    },
  },
};
const safetyResponse = await context.blockUnsafePreloadedActivationIfNeeded({
  sourceTab: { id: 3, windowId: 4 },
  sourceTabId: "3",
  targetUrl: "https://download.example/file.zip",
  entry: { realPreloadSafety: { sideEffect: true } },
  preloadedTab: { id: 42 },
});
assert.equal(safetyResponse.handled, false);
assert.equal(safetyResponse.reason, "real-preload-safety-guard");
assert.deepEqual(closedTabs, [42]);
assert.equal(
  storedPreloadState.normalWindowsById[4].sourceTabs[3].sourceTabRuntime.hiddenTabEntriesByUrl[
    "https://download.example/file.zip"
  ],
  undefined,
  "危险条目没有从最新状态里删除"
);
assert.equal(savedPreloadState, storedPreloadState, "保存的应当是重读得到的最新状态");
assert.equal(prunedRuntime.windowId, 4);
assert.equal(prunedRuntime.sourceTabId, "3");
assert.equal(
  updatedRuntime.sourceRuntimeEntry,
  storedPreloadState.normalWindowsById[4].sourceTabs[3],
  "markSourceRuntimeUpdated 收到的应当是重读后定位的 runtime，而不是陈旧快照"
);
assert.equal(debugEvents.at(-1).eventName, "preload-activation.safety-blocked");

const incognitoResponse = await context.validatePreloadedActivationIncognitoContext({
  sourceTab: { id: 5, windowId: 6, incognito: false },
  preloadedTab: { id: 7, incognito: false },
  targetWindowId: 9,
  targetUrl: "https://target.example/",
});
assert.equal(incognitoResponse.ok, false);
assert.equal(incognitoResponse.response.handled, false);
assert.equal(incognitoResponse.response.reason, "incognito-context-mismatch");
assert.equal(debugEvents.at(-1).eventName, "preload-activation.incognito-mismatch");

console.log("preload activation helper tests passed");
