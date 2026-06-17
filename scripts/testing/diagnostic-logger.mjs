import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(
  [
    "../../extension/background/diagnostics/sanitize.js",
    "../../extension/background/diagnostics/logger/session.js",
    "../../extension/background/diagnostics/logger/event.js",
    "../../extension/background/diagnostics/logger/flush-buffer.js",
    "../../extension/background/diagnostics/logger.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const nativeRequests = [];
const context = vm.createContext({
  console,
  Date,
  Math,
  Number,
  String,
  clearTimeout,
  setTimeout,
  fetchNativeApp: async (endpoint, request) => {
    nativeRequests.push({ endpoint, request });
    return {
      written: request.body.events.length,
      path: "D:\\logs\\diagnostics.jsonl",
    };
  },
  globalThis: {
    chrome: {
      runtime: {
        id: "test-extension",
        getManifest: () => ({
          version: "1.0.11",
          default_locale: "en",
        }),
      },
    },
  },
});

for (const [index, source] of sources.entries()) {
  vm.runInContext(source, context, {
    filename: `diagnostics-source-${index}.js`,
  });
}

const diagnostics = context.globalThis.ZeroLatencyDiagnostics;
diagnostics.configureFromSettings({
  diagnostics: {
    enabled: true,
  },
  preloading: {
    aiPrediction: {
      apiKeys: {
        openai: "secret-key",
      },
    },
  },
});
diagnostics.record(
  "tracking.visit.saved",
  {
    url: "https://example.com/page",
    token: "secret-token",
  },
  {
    level: "debug",
    tabId: 7,
  }
);

const flushResult = await diagnostics.flushNow();
assert.equal(flushResult.ok, true);
assert.equal(nativeRequests.length, 1);
assert.equal(nativeRequests[0].endpoint, "/api/v1/diagnostics/logs");

const flushedEvents = nativeRequests[0].request.body.events;
assert.equal(flushedEvents.length, 3);
assert.equal(flushedEvents[0].eventName, "diagnostics.enabled");
assert.equal(flushedEvents[1].eventName, "diagnostics.config");
assert.equal(flushedEvents[1].payload.settings.preloading.aiPrediction.apiKeys, "[redacted]");
assert.equal(flushedEvents[2].eventName, "tracking.visit.saved");
assert.equal(flushedEvents[2].payload.token, "[redacted]");
assert.equal(flushedEvents[2].tabId, 7);
assert.equal(diagnostics.getStatus().lastNativeLogPath, "D:\\logs\\diagnostics.jsonl");

diagnostics.configureFromSettings({
  diagnostics: {
    enabled: false,
  },
});
await diagnostics.flushNow({ finalFlush: true });
assert.equal(diagnostics.getStatus().enabled, false);
assert.equal(nativeRequests.length, 2);
assert.equal(nativeRequests[1].request.body.finalFlush, true);
assert.equal(nativeRequests[1].request.body.events[0].eventName, "diagnostics.disabled");

console.log("diagnostic logger tests passed");
