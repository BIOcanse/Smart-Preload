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
  ["extension", "background", "core", "state", "config.js"],
  ["extension", "background", "tracking", "url", "google.js"],
  ["extension", "background", "tracking", "url", "network.js"],
  ["extension", "background", "tracking", "url", "model.js"],
  ["extension", "background", "tracking", "graph", "model", "schema.js"],
  ["extension", "background", "tracking", "graph", "model", "normalize", "learning.js"],
  ["extension", "background", "tracking", "graph", "model", "normalize", "messages.js"],
  ["extension", "background", "tracking", "graph", "model", "normalize", "startup.js"],
  ["extension", "background", "tracking", "graph", "model", "edge-stats.js"],
  ["extension", "background", "tracking", "graph", "events", "transitions.js"],
  ["extension", "background", "tracking", "graph", "model", "normalize", "graph.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "buckets.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "query", "window.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "query", "source.js"],
  ["extension", "background", "tracking", "graph", "indexes", "keywords.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "messages", "buckets.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "messages", "page-indexes.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "messages", "records.js"],
  ["extension", "background", "tracking", "graph", "indexes", "transitions", "messages.js"],
  ["extension", "background", "tracking", "history-deletion", "range.js"],
  ["extension", "background", "tracking", "history-deletion", "stores.js"],
  ["extension", "background", "tracking", "history-deletion", "rebuild.js"],
  ["extension", "background", "tracking", "history-deletion.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Map,
  Math,
  Number,
  Object,
  URL,
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

  if (scriptPath.endsWith(path.join("core", "state", "config.js"))) {
    const constants = context.createBackgroundStateConstants();
    Object.assign(context, constants);
  }
}

context.getEffectiveExtensionSettings = () => ({
  tracking: {
    trackGoogleSearchPages: false,
    excludeGoogleInternalPages: false,
  },
});

const { deleteTrackingHistoryRange } = context.ZeroLatencyTrackingHistoryDeletion;
const graph = context.createEmptyGraph();

graph.nodes = {
  "https://a.example": createNode("https://a.example", "a.example"),
  "https://b.example": createNode("https://b.example", "b.example"),
  "https://c.example": createNode("https://c.example", "c.example"),
};
graph.transitionSequence = 3;
graph.transitionMessages = [
  createTransitionMessage({
    sequenceNumber: 1,
    fromNodeId: "https://a.example",
    toNodeId: "https://b.example",
    fromPageUrl: "https://a.example/one",
    toPageUrl: "https://b.example/one",
    occurredAt: "2026-06-01T10:00:00.000Z",
  }),
  createTransitionMessage({
    sequenceNumber: 2,
    fromNodeId: "https://b.example",
    toNodeId: "https://c.example",
    fromPageUrl: "https://b.example/one",
    toPageUrl: "https://c.example/delete-me",
    occurredAt: "2026-06-02T10:00:00.000Z",
  }),
  createTransitionMessage({
    sequenceNumber: 3,
    fromNodeId: "https://a.example",
    toNodeId: "https://b.example",
    fromPageUrl: "https://a.example/two",
    toPageUrl: "https://b.example/two",
    occurredAt: "2026-06-03T10:00:00.000Z",
  }),
];
graph.recentForegroundPages = [
  {
    tabId: 1,
    windowId: 1,
    nodeId: "https://b.example",
    pageUrl: "https://b.example/keep",
    title: "Keep",
    textDigest: "keep",
    contentFingerprint: "keep",
    activatedAt: "2026-06-01T09:00:00.000Z",
    leftForegroundAt: null,
  },
  {
    tabId: 2,
    windowId: 1,
    nodeId: "https://c.example",
    pageUrl: "https://c.example/delete",
    title: "Delete",
    textDigest: "delete",
    contentFingerprint: "delete",
    activatedAt: "2026-06-02T11:00:00.000Z",
    leftForegroundAt: null,
  },
];
graph.historyPageTitles = ["Delete", "Keep"];
graph.historyPageUrls = ["https://c.example/delete", "https://b.example/keep"];
graph.historyPageTexts = ["delete", "keep"];
graph.pageKeywordStore = {
  "https://b.example/keep": {
    pageUrl: "https://b.example/keep",
    siteNodeId: "https://b.example",
    title: "Keep",
    keywords: [{ text: "keep", score: 0.8 }],
    generatedAt: "2026-06-01T09:30:00.000Z",
  },
  "https://c.example/delete": {
    pageUrl: "https://c.example/delete",
    siteNodeId: "https://c.example",
    title: "Delete",
    keywords: [{ text: "delete", score: 0.9 }],
    generatedAt: "2026-06-02T09:30:00.000Z",
  },
};
graph.linkBehaviorStore = {
  "https://a.example/one": {
    "https://b.example/one": {
      selfCount: 1,
      blankCount: 0,
      lastTargetHint: "_self",
      lastSeenAt: "2026-06-01T10:01:00.000Z",
    },
    "https://c.example/delete-me": {
      selfCount: 0,
      blankCount: 2,
      lastTargetHint: "_blank",
      lastSeenAt: "2026-06-02T10:01:00.000Z",
    },
  },
};

const normalizedGraph = context.normalizeTrackingGraph(graph);
assert.equal(
  context.getTransitionCount(
    normalizedGraph,
    "total",
    "https://a.example",
    "https://b.example"
  ),
  2
);
assert.equal(
  context.getTransitionCount(
    normalizedGraph,
    "total",
    "https://b.example",
    "https://c.example"
  ),
  1
);

const deletion = deleteTrackingHistoryRange(
  {
    graph: normalizedGraph,
    tabState: { 1: { nodeId: "https://b.example", url: "https://b.example/keep" } },
    pendingSources: {},
  },
  {
    startDate: "2026-06-02",
    endDate: "2026-06-03",
  }
);
const deletedGraph = deletion.state.graph;

assert.equal(deletion.result.deleted.transitionMessages, 1);
assert.equal(deletion.result.deleted.recentForegroundPages, 1);
assert.equal(deletion.result.deleted.pageKeywords, 1);
assert.equal(deletion.result.deleted.linkBehaviorRecords, 1);
assert.equal(deletedGraph.transitionMessages.length, 2);
assert.equal(deletedGraph.edges["https://b.example -> https://c.example"], undefined);
assert.equal(
  context.getTransitionCount(
    deletedGraph,
    "total",
    "https://a.example",
    "https://b.example"
  ),
  2
);
assert.equal(
  context.getTransitionCount(
    deletedGraph,
    "total",
    "https://b.example",
    "https://c.example"
  ),
  0
);
assert.equal(deletedGraph.pageKeywordStore["https://c.example/delete"], undefined);
assert.equal(deletedGraph.pageKeywordBuckets.byKeyword.delete, undefined);
assert.ok(deletedGraph.pageKeywordBuckets.byKeyword.keep);
assert.equal(
  deletedGraph.linkBehaviorStore["https://a.example/one"]["https://c.example/delete-me"],
  undefined
);
assert.ok(deletedGraph.linkBehaviorStore["https://a.example/one"]["https://b.example/one"]);
assert.deepEqual(Array.from(deletedGraph.historyPageUrls), ["https://b.example/keep"]);
assert.equal(deletedGraph.transitionSequence, 3);

assert.throws(
  () => deleteTrackingHistoryRange({ graph: deletedGraph }, {}),
  /Select both UTC/
);
assert.throws(
  () =>
    deleteTrackingHistoryRange(
      { graph: deletedGraph },
      {
        startDate: "2026-06-03",
        endDate: "2026-06-03",
      }
    ),
  /UTC start date/
);

console.log("history deletion tests passed");

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
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: "2026-06-03T00:00:00.000Z",
  };
}

function createTransitionMessage({
  sequenceNumber,
  fromNodeId,
  toNodeId,
  fromPageUrl,
  toPageUrl,
  occurredAt,
}) {
  return {
    sequenceNumber,
    fromNodeId,
    toNodeId,
    fromHost: new URL(fromNodeId).host,
    toHost: new URL(toNodeId).host,
    fromPageUrl,
    toPageUrl,
    tabId: 1,
    occurredAt,
    eventType: "committed",
    transitionType: "link",
    url: toPageUrl,
  };
}
