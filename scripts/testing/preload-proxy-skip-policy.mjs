import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "shared", "settings.js"],
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "lookup", "pruning.js"],
  ["extansion", "background", "preload", "proxy-skip-policy.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Number,
  URL,
  PRELOAD_WINDOW_SENTINEL_URL: "chrome-extension://test/preload-window.html",
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};
context.ZeroLatencySupport = {
  hasChromeNamespaceMethod(namespace, method) {
    return Boolean(context.chrome?.[namespace]?.[method]);
  },
};
context.currentSettings = context.ZeroLatencySettings?.DEFAULT_SETTINGS ?? null;
context.getEffectiveExtensionSettings = () => context.currentSettings;
context.chrome = {
  tabs: {
    async query() {
      return [
        { id: 1, windowId: 10, url: "https://proxied.example/path" },
        { id: 2, windowId: 10, url: "https://direct.example/path" },
      ];
    },
  },
};

vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const settingsApi = context.ZeroLatencySettings;
assert.equal(settingsApi.normalizeStoredSettings({}).preloading.proxySkip.enabled, false);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      settingsApi.normalizeProxySkipRules(" proxied.example \n# comment\n\n*.media.example ")
    )
  ),
  ["proxied.example", "*.media.example"]
);

const blacklistSettings = settingsApi.normalizeStoredSettings({
  preloading: {
    proxySkip: {
      enabled: true,
      mode: "blacklist",
      rules: [
        "proxied.example",
        "*.media.example",
        "https://docs.example/path/*",
        "localhost:7890",
      ],
    },
  },
});

assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://proxied.example/page", blacklistSettings),
  true
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://sub.proxied.example/page", blacklistSettings),
  true
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://cdn.media.example/video", blacklistSettings),
  true
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://docs.example/path/a", blacklistSettings),
  true
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("http://localhost:7890/ui", blacklistSettings),
  true
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://direct.example/page", blacklistSettings),
  false
);

const whitelistSettings = settingsApi.normalizeStoredSettings({
  preloading: {
    proxySkip: {
      enabled: true,
      mode: "whitelist",
      rules: ["direct.example"],
    },
  },
});

assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://direct.example/page", whitelistSettings),
  false
);
assert.equal(
  settingsApi.shouldSkipProxyRuleUrl("https://proxied.example/page", whitelistSettings),
  true
);

context.currentSettings = blacklistSettings;
assert.equal(
  context.ZeroLatencyPreloadProxySkipPolicy.shouldSkipProxyPreloadSource({
    id: 1,
    url: "https://proxied.example/path",
  }),
  true
);
assert.equal(
  context.ZeroLatencyPreloadProxySkipPolicy.shouldSkipProxyPreloadCandidate(
    "https://direct.example/path"
  ),
  false
);

const preloadState = context.createEmptyPreloadState();
preloadState.scheduler.candidateSelectionSnapshotsByTabId["1"] = {
  sourceTabId: 1,
  sourceWindowId: 10,
  sourcePageUrl: "https://proxied.example/path",
};
preloadState.scheduler.candidateSelectionSnapshotsByTabId["2"] = {
  sourceTabId: 2,
  sourceWindowId: 10,
  sourcePageUrl: "https://direct.example/path",
};
preloadState.scheduler.attentionPendingByKey["1|https://proxied.example/path"] = {
  tabId: 1,
  pageUrl: "https://proxied.example/path",
};
preloadState.scheduler.activeTabCursor = {
  tabId: 1,
  windowId: 10,
  pageUrl: "https://proxied.example/path",
  counting: true,
  weight: 1,
  activityKind: "input",
};

const cleanup = await context.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
  preloadState,
  blacklistSettings,
  {
    tabs: [
      { id: 1, windowId: 10, url: "https://proxied.example/path" },
      { id: 2, windowId: 10, url: "https://direct.example/path" },
    ],
    reason: "test",
  }
);

assert.equal(cleanup.mutated, true);
assert.deepEqual(JSON.parse(JSON.stringify(cleanup.clearedSourceTabIds)), [1]);
assert.equal(
  cleanup.preloadState.scheduler.candidateSelectionSnapshotsByTabId["1"],
  undefined
);
assert.equal(
  cleanup.preloadState.scheduler.candidateSelectionSnapshotsByTabId["2"].sourceTabId,
  2
);
assert.deepEqual(
  JSON.parse(JSON.stringify(cleanup.preloadState.scheduler.attentionPendingByKey)),
  {}
);
assert.equal(cleanup.preloadState.scheduler.activeTabCursor.counting, false);

console.log("preload proxy skip policy tests passed");
