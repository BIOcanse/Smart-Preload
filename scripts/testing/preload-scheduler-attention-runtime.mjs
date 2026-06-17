import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const scriptPaths = [
  path.join(
    repoRoot,
    "extension",
    "background",
    "preload",
    "scheduler",
    "attention",
    "runtime",
    "source.js"
  ),
  path.join(
    repoRoot,
    "extension",
    "background",
    "preload",
    "scheduler",
    "attention",
    "runtime",
    "mutation.js"
  ),
  path.join(
    repoRoot,
    "extension",
    "background",
    "preload",
    "scheduler",
    "attention",
    "runtime.js"
  ),
];

const observations = [];
const notifications = [];
let savedPreloadState = {
  scheduler: {
    activeTabCursor: {
      tabId: 1,
      windowId: 10,
    },
  },
  preloadTabIds: new Set([99]),
};
let queueRuns = 0;

const tabs = new Map([
  [
    1,
    {
      id: 1,
      windowId: 10,
      url: "https://source.test/page",
      active: true,
      incognito: false,
    },
  ],
  [
    99,
    {
      id: 99,
      windowId: 10,
      url: "https://hidden.test/preload",
      active: true,
      incognito: false,
    },
  ],
]);
const windows = new Map([
  [
    10,
    {
      id: 10,
      type: "normal",
      focused: true,
      incognito: false,
    },
  ],
]);

const context = {
  console,
  Math,
  Number,
  Date,
  chrome: {
    tabs: {
      query: async ({ windowId, active }) =>
        [...tabs.values()].filter(
          (tab) => tab.windowId === windowId && (active !== true || tab.active === true)
        ),
    },
  },
  normalizePositiveInteger(value, fallback = null) {
    const numericValue = Number(value);

    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  },
  getTabMaybe(tabId) {
    return tabs.get(tabId) ?? null;
  },
  getWindowMaybe(windowId) {
    return windows.get(windowId) ?? null;
  },
  getEffectiveExtensionSettings() {
    return {};
  },
  isTrackableAndAllowedUrl(url) {
    return /^https?:\/\//.test(url);
  },
  async loadPreloadState() {
    return savedPreloadState;
  },
  async savePreloadState(preloadState) {
    savedPreloadState = preloadState;
  },
  async queueMutation(task) {
    queueRuns += 1;
    await task();
  },
  isPreloadTab(preloadState, tabId) {
    return preloadState.preloadTabIds?.has?.(tabId) === true;
  },
  normalizePreloadAttentionCursor(cursor) {
    return {
      tabId: Number.isInteger(Number(cursor?.tabId)) ? Number(cursor.tabId) : null,
      windowId: Number.isInteger(Number(cursor?.windowId)) ? Number(cursor.windowId) : null,
    };
  },
  ZeroLatencyPreloadIncognitoPolicy: {
    shouldExcludeIncognitoPreloadSource() {
      return false;
    },
  },
  ZeroLatencyPreloadProxySkipPolicy: {
    shouldSkipProxyPreloadSource() {
      return false;
    },
  },
  ZeroLatencyPreloadAttentionActivity: {
    buildPreloadAttentionRuntimeOptions(options = {}) {
      return {
        activity: options.activity,
      };
    },
    resolveAttentionActivity(activity) {
      return {
        kind: activity?.kind || "input",
        weight: Number.isFinite(Number(activity?.weight)) ? Number(activity.weight) : 1,
        expiresAt: activity?.expiresAt || null,
      };
    },
  },
  ZeroLatencyPreloadAttentionPool: {
    normalizeAttentionPageUrl(url) {
      return typeof url === "string" ? url.trim() : "";
    },
  },
  ZeroLatencyPreloadAttentionObservation: {
    async recordPreloadAttentionObservationAndMaybeReschedule(
      preloadState,
      observation,
      _runtimeOptions
    ) {
      observations.push(JSON.parse(JSON.stringify(observation)));

      return {
        preloadState: {
          ...preloadState,
          lastObservation: observation,
        },
        rescheduled: observation.counting === true,
      };
    },
    async notifyAttentionReschedule(result) {
      notifications.push(result ? JSON.parse(JSON.stringify(result)) : null);
    },
  },
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

await context.ZeroLatencyPreloadAttentionRuntime.recordActiveTabAttentionFromActiveInfo(
  { tabId: 1 },
  "tab-activated",
  {
    activity: {
      kind: "input",
      weight: 1,
      expiresAt: "2026-06-17T00:00:00.000Z",
    },
  }
);

assert.equal(queueRuns, 1);
assert.equal(observations.length, 1);
assert.equal(observations[0].tabId, 1);
assert.equal(observations[0].windowId, 10);
assert.equal(observations[0].pageUrl, "https://source.test/page");
assert.equal(observations[0].counting, true);
assert.equal(observations[0].activityKind, "input");
assert.equal(notifications.length, 1);
assert.equal(notifications[0].rescheduled, true);

await context.ZeroLatencyPreloadAttentionRuntime.recordActiveTabAttentionFromActiveInfo(
  { tabId: 99 },
  "tab-activated",
  { queue: false }
);

assert.equal(observations.length, 1);
assert.equal(notifications.length, 2);
assert.equal(notifications[1], null);

await context.ZeroLatencyPreloadAttentionRuntime.pausePreloadAttentionCursorIfMatches(
  { tabId: 1 },
  "tab-removed",
  { queue: false }
);

assert.equal(observations.length, 2);
assert.equal(observations[1].counting, false);
assert.equal(observations[1].reason, "tab-removed");
assert.equal(notifications.length, 3);
assert.equal(notifications[2].rescheduled, false);

console.log("preload scheduler attention runtime tests passed");
