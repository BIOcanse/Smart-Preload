import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(
  [
    "../../extension/background/preload/runtime/source-tabs/channels.js",
    "../../extension/background/preload/runtime/activation/target.js",
    "../../extension/background/preload/runtime/activation/safety.js",
    "../../extension/background/preload/runtime/activation/incognito.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const debugEvents = [];
const closedTabs = [];
let savedPreloadState = null;
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
  },
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

const preloadState = { updatedAt: "" };
const sourceRuntimeEntry = {
  sourceTabRuntime: {
    hiddenTabEntriesByUrl: {
      "https://download.example/file.zip": { tabId: 42 },
    },
  },
};
const safetyResponse = await context.blockUnsafePreloadedActivationIfNeeded({
  preloadState,
  sourceRuntimeEntry,
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
  sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl["https://download.example/file.zip"],
  undefined
);
assert.equal(savedPreloadState, preloadState);
assert.equal(prunedRuntime.windowId, 4);
assert.equal(prunedRuntime.sourceTabId, "3");
assert.equal(updatedRuntime.sourceRuntimeEntry, sourceRuntimeEntry);
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
