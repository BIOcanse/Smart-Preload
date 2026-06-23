import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "shared", "settings", "utils.js"],
  ["extension", "shared", "settings", "schema", "localize.js"],
  ["extension", "shared", "settings", "schema", "constants.js"],
  ["extension", "shared", "settings", "schema", "options.js"],
  ["extension", "shared", "settings", "schema", "rule-cards.js"],
  ["extension", "shared", "settings", "schema.js"],
  ["extension", "shared", "settings", "defaults.js"],
  ["extension", "shared", "settings", "rules.js"],
  ["extension", "shared", "settings", "proxy-skip.js"],
  ["extension", "shared", "settings", "ai.js"],
  ["extension", "shared", "settings", "effective.js"],
  ["extension", "shared", "settings", "migrations.js"],
  ["extension", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extension", "shared", "settings", "normalize", "preload.js"],
  ["extension", "shared", "settings", "normalize", "scheduler.js"],
  ["extension", "shared", "settings", "normalize.js"],
  ["extension", "shared", "settings", "storage.js"],
  ["extension", "shared", "settings.js"],
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "channel.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "safety.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "entries.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs.js"],
  ["extension", "background", "preload", "runtime", "source-tabs", "channels.js"],
  ["extension", "background", "preload", "runtime", "source-tabs", "hidden-tabs.js"],
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
