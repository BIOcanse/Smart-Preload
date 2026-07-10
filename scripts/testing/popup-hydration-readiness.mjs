import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const debugMessagesPath = path.join(
  repoRoot,
  "extension",
  "background",
  "core",
  "messages",
  "debug.js"
);
let resolveHydration;
const hydration = new Promise((resolve) => {
  resolveHydration = resolve;
});
let snapshotLoads = 0;
const context = {
  console,
  whenBackgroundStateReady: () => hydration,
  async loadTrackingSnapshotForPopup() {
    snapshotLoads += 1;
    return {
      summary: { nodeCount: 3 },
      tabState: {},
      preloadState: {},
      serviceState: { paused: false },
    };
  },
  buildPageContext: () => ({ currentTabId: 7 }),
  buildCurrentPreloads: () => [],
  resolvePreloadPerformanceWarning: async () => null,
  resolveNativeAppModeWarning: async () => null,
  resolveRealPreloadRecommendationWarning: () => null,
  handleDeleteHistoryRange: async () => ({ ok: true }),
  resetPreloads: async () => {},
  saveTrackingState: async () => {},
  createEmptyGraph: () => ({}),
  ZeroLatencyDebugEvents: { clear: () => {} },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(debugMessagesPath, "utf8"), context, {
  filename: debugMessagesPath,
});

const pendingSnapshot = context.ZeroLatencyCoreDebugMessages.handleDebugSnapshot({
  mode: "popup",
  tabId: 7,
});
await Promise.resolve();
assert.equal(snapshotLoads, 0);

resolveHydration();
const snapshot = await pendingSnapshot;
assert.equal(snapshotLoads, 1);
assert.equal(snapshot.summary.nodeCount, 3);
assert.equal(snapshot.mode, "popup");

console.log("popup hydration readiness tests passed");
