import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  "extension/background/shared/base.js",
  "extension/background/core/state/config.js",
  "extension/background/tracking/url/google.js",
  "extension/background/tracking/url/network.js",
  "extension/background/tracking/url/model.js",
  "extension/background/tracking/graph/model/schema.js",
  "extension/background/tracking/graph/model/normalize/learning.js",
  "extension/background/tracking/graph/model/normalize/messages.js",
  "extension/background/tracking/graph/model/normalize/startup.js",
  "extension/background/tracking/graph/model/edge-stats.js",
  "extension/background/tracking/graph/events/transitions.js",
  "extension/background/tracking/graph/model/normalize/graph.js",
  "extension/background/tracking/graph/indexes/transitions/buckets.js",
  "extension/background/tracking/graph/indexes/transitions/query/window.js",
  "extension/background/tracking/graph/indexes/transitions/query/source.js",
  "extension/background/tracking/graph/indexes/keywords.js",
  "extension/background/tracking/graph/indexes/transitions/messages/buckets.js",
  "extension/background/tracking/graph/indexes/transitions/messages/page-indexes.js",
  "extension/background/tracking/graph/indexes/transitions/messages/records.js",
  "extension/background/tracking/graph/indexes/transitions/messages.js",
  "extension/background/tracking/history-deletion/range.js",
  "extension/background/tracking/history-deletion/stores.js",
  "extension/background/tracking/history-deletion/rebuild.js",
  "extension/background/tracking/history-deletion.js",
  "extension/background/tracking/history-transfer/format.js",
  "extension/background/tracking/history-transfer/service.js",
  "extension/background/tracking/history-transfer.js",
].map((relativePath) => path.join(repoRoot, relativePath));

const debugEvents = [];
const currentRuntimeState = {
  graph: null,
  tabState: {
    41: {
      nodeId: "https://current.example",
      url: "https://current.example/live",
    },
  },
  pendingSources: {
    41: {
      sourcePageUrl: "https://current.example/live",
    },
  },
};
let replacedState = null;

const context = {
  console,
  Date,
  Map,
  Math,
  Number,
  Object,
  URL,
  chrome: {
    runtime: {
      getManifest: () => ({ version: "1.0.17" }),
    },
  },
  getEffectiveExtensionSettings: () => ({
    tracking: {
      trackGoogleSearchPages: false,
      excludeGoogleInternalPages: false,
    },
  }),
  loadTrackingStateWithCompleteHistory: async () => ({
    graph: context.exportGraph,
    tabState: { 999: { url: "https://must-not-export.example" } },
    pendingSources: { secret: true },
    settings: { apiKey: "must-not-export" },
  }),
  loadTrackingState: async () => currentRuntimeState,
  replaceTrackingHistoryArchive: async (state) => {
    replacedState = state;
  },
  ZeroLatencyDebugEvents: {
    record(name, payload) {
      debugEvents.push({ name, payload });
    },
  },
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

  if (scriptPath.endsWith(path.join("core", "state", "config.js"))) {
    Object.assign(context, context.createBackgroundStateConstants());
  }
}

const graph = context.createEmptyGraph();
graph.nodes = {
  "https://source.example": createNode("https://source.example", "source.example"),
  "https://target.example": createNode("https://target.example", "target.example"),
};
graph.transitionSequence = 7;
graph.transitionMessages = [
  {
    sequenceNumber: 7,
    fromNodeId: "https://source.example",
    toNodeId: "https://target.example",
    fromHost: "source.example",
    toHost: "target.example",
    fromPageUrl: "https://source.example/start",
    toPageUrl: "https://target.example/result",
    tabId: 3,
    occurredAt: "2026-07-14T10:00:00.000Z",
    eventType: "committed",
    transitionType: "link",
    transitionQualifiers: [],
    learned: true,
  },
];
graph.recentForegroundPages = [
  {
    tabId: 3,
    windowId: 1,
    nodeId: "https://source.example",
    pageUrl: "https://source.example/start",
    title: "Private project page",
    textDigest: "private project notes",
    contentFingerprint: "fingerprint",
    activatedAt: "2026-07-14T09:59:00.000Z",
    leftForegroundAt: "2026-07-14T10:00:00.000Z",
  },
];
graph.pageKeywordStore = {
  "https://source.example/start": {
    pageUrl: "https://source.example/start",
    siteNodeId: "https://source.example",
    title: "Private project page",
    keywords: [{ text: "private", score: 0.9 }],
    generatedAt: "2026-07-14T09:59:30.000Z",
  },
};
context.ZeroLatencyTrackingHistoryDeletion.rebuildDerivedTrackingHistoryIndexes(graph, {
  previousTransitionSequence: 7,
  updatedAt: "2026-07-14T10:01:00.000Z",
});
context.exportGraph = graph;

const format = context.ZeroLatencyTrackingHistoryTransferFormat;
const backup = format.createHistoryBackup(graph, {
  exportedAt: "2026-07-15T00:00:00.000Z",
  extensionVersion: "1.0.17",
});

assert.equal(backup.format, "smart-preload-history");
assert.equal(backup.formatVersion, 1);
assert.equal(backup.summary.transitionMessages, 1);
assert.equal(backup.summary.sites, 2);
assert.equal(backup.summary.routes, 1);
assert.equal(backup.summary.pageKeywords, 1);

const parsed = format.parseHistoryBackup(JSON.stringify(backup));
assert.equal(parsed.metadata.extensionVersion, "1.0.17");
assert.equal(parsed.graph.transitionMessages.length, 1);
assert.equal(
  context.getTransitionCount(
    parsed.graph,
    "total",
    "https://source.example",
    "https://target.example"
  ),
  1
);
assert.ok(parsed.graph.pageKeywordBuckets.byKeyword.private);

assert.throws(() => format.parseHistoryBackup("not-json"), /valid JSON/);
assert.throws(
  () => format.parseHistoryBackup({ ...backup, formatVersion: 999 }),
  /Unsupported history backup format version/
);
assert.throws(
  () => format.parseHistoryBackup({ ...backup, history: {} }),
  /does not contain a visit graph/
);

const exported = await context.ZeroLatencyTrackingHistoryTransfer.exportHistory();
const exportedJson = JSON.stringify(exported);
assert.equal(exported.extensionVersion, "1.0.17");
assert.equal(exportedJson.includes("must-not-export"), false);
assert.equal(exportedJson.includes("pendingSources"), false);
assert.equal(exportedJson.includes("tabState"), false);

const validation = context.ZeroLatencyTrackingHistoryTransfer.validateHistoryImport(
  JSON.stringify(backup)
);
assert.equal(validation.summary.transitionMessages, 1);

const importResult = await context.ZeroLatencyTrackingHistoryTransfer.importHistory(
  JSON.stringify(backup)
);
assert.equal(importResult.ok, true);
assert.equal(importResult.summary.transitionMessages, 1);
assert.deepEqual(toPlain(replacedState.tabState), toPlain(currentRuntimeState.tabState));
assert.deepEqual(
  toPlain(replacedState.pendingSources),
  toPlain(currentRuntimeState.pendingSources)
);
assert.notEqual(replacedState.graph, currentRuntimeState.graph);
assert.equal(debugEvents.at(-1)?.name, "tracking.history.import");

console.log("history transfer tests passed");

function createNode(nodeId, host) {
  return {
    nodeId,
    origin: nodeId,
    host,
    hostname: host,
    protocol: "https",
    sampleUrl: `${nodeId}/`,
    defaultLandingPageUrl: `${nodeId}/`,
    visitCount: 1,
    firstSeenAt: "2026-07-14T00:00:00.000Z",
    lastSeenAt: "2026-07-14T10:00:00.000Z",
  };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
