import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scripts = [
  "extension/background/shared/base.js",
  "extension/background/core/state/config.js",
  "extension/background/tracking/url/google.js",
  "extension/background/tracking/url/network.js",
  "extension/background/tracking/url/model.js",
  "extension/background/tracking/graph/model/schema.js",
  "extension/background/tracking/graph/model/normalize/messages.js",
  "extension/background/tracking/graph/model/edge-stats.js",
  "extension/background/tracking/storage/history-archive.js",
];
const context = vm.createContext({ console, Date, Map, Math, Number, Object, URL });
context.globalThis = context;

for (const relativePath of scripts) {
  const sourcePath = path.join(repositoryRoot, relativePath);
  vm.runInContext(readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });

  if (relativePath.endsWith("core/state/config.js")) {
    Object.assign(context, context.createBackgroundStateConstants());
  }
}

const storage = createStorage();
const archive = context.ZeroLatencyTrackingHistoryArchive;
const manifestKey = "manifest";
const messages = Array.from({ length: 610 }, (_, index) =>
  createMessage(index + 1, index < 600 ? "2026-07-09" : "2026-07-10")
);
let manifest = await archive.appendTransitionMessages({
  chromeStorage: storage,
  manifestKey,
  manifest: archive.createEmptyHistoryManifest(),
  messages,
});

assert.equal(manifest.maxSequence, 610);
assert.equal(manifest.chunks.length, 4);
assert.ok(manifest.chunks.every((chunk) => chunk.count <= archive.HISTORY_CHUNK_SIZE));
assert.equal((await archive.loadAllTransitionMessages({ chromeStorage: storage, manifest })).length, 610);

manifest = await archive.appendTransitionMessages({
  chromeStorage: storage,
  manifestKey,
  manifest,
  messages,
});
assert.equal(manifest.chunks.length, 4, "re-appending checkpointed messages must be idempotent");

const retained = messages.filter((message) => message.sequenceNumber % 3 === 0);
manifest = await archive.replaceTransitionMessages({
  chromeStorage: storage,
  manifestKey,
  manifest,
  messages: retained,
});
const reloaded = await archive.loadAllTransitionMessages({ chromeStorage: storage, manifest });
assert.equal(reloaded.length, retained.length);
assert.equal(reloaded.at(-1).sequenceNumber, 609);
assert.equal(
  [...storage.values.keys()].filter((key) => key.startsWith("trackingHistoryV1:")).length,
  manifest.chunks.length
);

console.log("tracking history archive tests passed");

function createMessage(sequenceNumber, date) {
  return {
    sequenceNumber,
    fromNodeId: "https://source.example",
    toNodeId: "https://target.example",
    fromHost: "source.example",
    toHost: "target.example",
    fromPageUrl: "https://source.example/",
    toPageUrl: `https://target.example/${sequenceNumber}`,
    tabId: 1,
    occurredAt: `${date}T12:00:00.000Z`,
    eventType: "committed",
    transitionType: "link",
    url: `https://target.example/${sequenceNumber}`,
  };
}

function createStorage() {
  const values = new Map();

  return {
    values,
    async get(query) {
      if (Array.isArray(query)) {
        return Object.fromEntries(query.filter((key) => values.has(key)).map((key) => [key, values.get(key)]));
      }

      return Object.fromEntries(
        Object.entries(query || {}).map(([key, fallback]) => [
          key,
          values.has(key) ? values.get(key) : fallback,
        ])
      );
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) {
        values.set(key, JSON.parse(JSON.stringify(value)));
      }
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        values.delete(key);
      }
    },
  };
}
