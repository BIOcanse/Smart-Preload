import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "shared", "settings", "utils.js"],
  ["extansion", "shared", "settings", "schema", "localize.js"],
  ["extansion", "shared", "settings", "schema", "constants.js"],
  ["extansion", "shared", "settings", "schema", "options.js"],
  ["extansion", "shared", "settings", "schema", "rule-cards.js"],
  ["extansion", "shared", "settings", "schema.js"],
  ["extansion", "shared", "settings", "defaults.js"],
  ["extansion", "shared", "settings", "rules.js"],
  ["extansion", "shared", "settings", "proxy-skip.js"],
  ["extansion", "shared", "settings", "ai.js"],
  ["extansion", "shared", "settings", "effective.js"],
  ["extansion", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extansion", "shared", "settings", "normalize", "preload.js"],
  ["extansion", "shared", "settings", "normalize", "scheduler.js"],
  ["extansion", "shared", "settings", "normalize.js"],
  ["extansion", "shared", "settings", "storage.js"],
  ["extansion", "shared", "settings.js"],
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "channel.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "safety.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "entries.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "channels.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "hidden-tabs.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Number,
  navigator: {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "node-test",
  },
  BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH: "startupGoogleSearch",
  BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB: "newGoogleSearchTab",
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const settings = context.ZeroLatencySettings.resolveEffectiveSettings({
  preloadWindow: {
    fullscreenPressurePolicy: "sleep",
  },
});
context.getEffectiveExtensionSettings = () => settings;
context.getPreloadResourcePressureState = async () => ({
  shouldDeferHiddenTabs: true,
  policy: "sleep",
  reason: "game-process",
});

let reassignCalled = false;
context.reassignSourceTabRuntimeIfNeeded = async () => {
  reassignCalled = true;
  throw new Error("resource pressure should skip before reassignment");
};

const preloadState = { normalWindowsById: {} };
const result = await context.synchronizePreloadsForSourceTab(preloadState, 10, 20, [
  { url: "https://target.example/a", score: 1 },
]);

assert.equal(result, preloadState);
assert.equal(reassignCalled, false);
assert.deepEqual(
  context.ZeroLatencyDebugEvents.events.map((event) => event.name),
  ["hidden-tab.sync.resource-pressure-skip"]
);
assert.deepEqual(JSON.parse(JSON.stringify(context.ZeroLatencyDebugEvents.events[0].payload)), {
  normalWindowId: 10,
  sourceTabId: 20,
  targetCount: 1,
  channel: "scheduled",
  policy: "sleep",
  reason: "game-process",
});

console.log("preload resource pressure policy tests passed");
