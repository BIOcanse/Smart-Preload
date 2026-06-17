import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "learning", "foreground-pages", "context.js"],
  ["extansion", "background", "learning", "foreground-pages", "record.js"],
  ["extansion", "background", "learning", "foreground-pages", "keywords.js"],
  ["extansion", "background", "learning", "foreground-pages.js"],
].map((segments) => path.join(repoRoot, ...segments));

let paused = true;
let trackingState = {
  graph: {
    recentForegroundPages: [],
    pageKeywordStore: {},
  },
};
const appliedEvents = [];
const savedStates = [];
const aiCalls = [];

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
  async isExtensionServicePaused() {
    return paused;
  },
  normalizePageUrlForIndex(rawUrl) {
    try {
      return new URL(rawUrl).href;
    } catch (_error) {
      return "";
    }
  },
  isTrackableAndAllowedUrl(url) {
    return /^https?:\/\//.test(url);
  },
  async loadPreloadState() {
    return { preloadTabIds: new Set() };
  },
  isPreloadTab(preloadState, tabId) {
    return preloadState.preloadTabIds?.has?.(tabId) === true;
  },
  async getWindowMaybe(windowId) {
    return { id: windowId, focused: true };
  },
  buildNodeSeed(pageUrl) {
    return { nodeId: new URL(pageUrl).origin };
  },
  async loadTrackingState() {
    return trackingState;
  },
  async saveTrackingState(nextState) {
    trackingState = nextState;
    savedStates.push(JSON.parse(JSON.stringify(nextState)));
  },
  async queueMutation(task) {
    return task();
  },
  findPreloadEntryByTabId() {
    return null;
  },
  async applyTrackingEvent(state, event) {
    appliedEvents.push(event);
    const nextState = JSON.parse(JSON.stringify(state));

    if (event.type === "record-foreground-page") {
      nextState.graph.recentForegroundPages.unshift({
        pageUrl: event.pageUrl,
        title: event.title,
        textDigest: event.textDigest,
        contentFingerprint: event.contentFingerprint,
      });
    }

    if (event.type === "upsert-page-keywords") {
      nextState.graph.pageKeywordStore[event.pageUrl] = {
        pageUrl: event.pageUrl,
        keywords: event.keywords,
        pageType: event.pageType,
        contentFingerprint: event.contentFingerprint,
        expiresAt: event.expiresAt,
      };
    }

    return nextState;
  },
  async queryTrackingGraph(state, query) {
    if (query?.type === "get-page-keywords") {
      return state.graph.pageKeywordStore?.[query.pageUrl] ?? null;
    }

    return null;
  },
  getEffectiveExtensionSettings() {
    return {
      preloading: {
        effectiveAiPredictionConfigured: true,
        aiPrediction: {
          enabled: true,
          modelId: "test-model",
        },
      },
    };
  },
  ZeroLatencyAiProviders: {
    async invokeConfiguredAiProvider(_settings, prompt, options) {
      aiCalls.push({ prompt, options });
      return { output_text: '{"keywords":[{"text":"fast","score":1}],"pageType":"article"}' };
    },
  },
  ZeroLatencyAiKeywords: {
    buildPageKeywordPrompt(input) {
      return `prompt:${input.pageUrl}:${input.contentFingerprint}`;
    },
    parseAiKeywordInferenceResponse() {
      return {
        keywords: [{ text: "fast", score: 1 }],
        pageType: "article",
      };
    },
  },
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

let response = await context.ZeroLatencyLearningForegroundPages.handleForegroundPageDigest(
  { pageUrl: "https://example.com/page" },
  { tab: { id: 1, windowId: 10, url: "https://example.com/page", active: true } }
);
assert.deepEqual(JSON.parse(JSON.stringify(response)), {
  ok: true,
  skipped: true,
  reason: "service-paused",
});

paused = false;
response = await context.ZeroLatencyLearningForegroundPages.handleForegroundPageDigest(
  {
    pageUrl: "https://example.com/page",
    title: "Example",
    textDigest: "Useful page",
    contentFingerprint: "fp1",
  },
  { tab: { id: 1, windowId: 10, url: "https://example.com/page", active: true } }
);

assert.deepEqual(JSON.parse(JSON.stringify(response)), {
  ok: true,
  generatedKeywords: true,
});
assert.equal(appliedEvents[0].type, "record-foreground-page");
assert.equal(appliedEvents[1].type, "upsert-page-keywords");
assert.equal(aiCalls.length, 1);
assert.equal(
  context.ZeroLatencyLearningForegroundPages.shouldRefreshForegroundPageRecord(
    trackingState.graph,
    "https://example.com/page",
    "fp1",
    "Example",
    "Useful page"
  ),
  false
);
assert.equal(
  context.ZeroLatencyLearningForegroundPages.isKeywordEntryExpired({
    expiresAt: "2000-01-01T00:00:00.000Z",
  }),
  true
);

console.log("learning foreground pages tests passed");
