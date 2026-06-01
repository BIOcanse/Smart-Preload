import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "tracking", "url", "model.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "scheduler", "attention.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const {
  appendPreloadAttentionDuration,
  buildPreloadAttentionRuntimeOptions,
  recordPreloadAttentionObservation,
  computePreloadAttentionDwellShares,
  resolveAttentionActivity,
} = context.ZeroLatencyPreloadSchedulerAttention;

context.getEffectiveExtensionSettings = () => ({
  preloading: {
    effectivePreloadScheduler: {
      attentionPoolHours: 2,
      attentionSegmentSeconds: 60,
      attentionMaxObservableGapSeconds: 45,
      attentionInputWindowSeconds: 60,
      attentionMediaPlaybackWeight: 0.2,
      attentionAudioPlaybackWeight: 0.07,
    },
  },
});

assert.deepEqual(JSON.parse(JSON.stringify(buildPreloadAttentionRuntimeOptions())), {
  poolDurationMs: 7200000,
  segmentDurationMs: 60000,
  maxObservableGapMs: 45000,
  inputWindowMs: 60000,
  mediaPlaybackWeight: 0.2,
  audioPlaybackWeight: 0.07,
});

const startedAt = "2026-01-01T00:00:00.000Z";
const attentionPool = appendPreloadAttentionDuration(
  context.createEmptyPreloadSchedulerState().attentionPool,
  {
    tabId: 1,
    windowId: 10,
    pageUrl: "https://example.com/a#hash",
    durationMs: 120,
    startedAt,
    endedAt: "2026-01-01T00:00:00.120Z",
  },
  { poolDurationMs: 100, segmentDurationMs: 25 }
);

assert.equal(attentionPool.totalDurationMs, 100);
assert.equal(attentionPool.segments.length, 5);
assert.equal(attentionPool.segments[0].durationMs, 5);
assert.equal(attentionPool.segments[0].startedAt, "2026-01-01T00:00:00.020Z");
assert.equal(attentionPool.segments[0].pageUrl, "https://example.com/a");

let preloadState = context.createEmptyPreloadState();
let result = recordPreloadAttentionObservation(
  preloadState,
  {
    tabId: 1,
    windowId: 10,
    pageUrl: "https://example.com/a",
    observedAt: "2026-01-01T00:00:00.000Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 100 }
);
preloadState = result.preloadState;

result = recordPreloadAttentionObservation(
  preloadState,
  {
    tabId: 1,
    windowId: 10,
    pageUrl: "https://example.com/a",
    observedAt: "2026-01-01T00:00:00.500Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
preloadState = result.preloadState;
assert.equal(result.recordedDurationMs, 0);
assert.equal(preloadState.scheduler.attentionPool.totalDurationMs, 0);
assert.equal(preloadState.scheduler.activeTabCursor.pendingDurationMs, 500);

result = recordPreloadAttentionObservation(
  preloadState,
  {
    tabId: 1,
    windowId: 10,
    pageUrl: "https://example.com/a",
    observedAt: "2026-01-01T00:00:01.100Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
preloadState = result.preloadState;
assert.equal(result.recordedDurationMs, 1000);
assert.equal(preloadState.scheduler.attentionPool.totalDurationMs, 1000);
assert.equal(preloadState.scheduler.activeTabCursor.pendingDurationMs, 100);

result = recordPreloadAttentionObservation(
  preloadState,
  {
    tabId: 1,
    windowId: 10,
    pageUrl: "https://example.com/a",
    observedAt: "2026-01-01T00:00:03.000Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
preloadState = result.preloadState;
assert.equal(result.recordedDurationMs, 0);
assert.equal(result.skippedLongGap, true);
assert.equal(preloadState.scheduler.attentionPool.totalDurationMs, 1000);
assert.equal(preloadState.scheduler.activeTabCursor.pendingDurationMs, 100);

let switchState = context.createEmptyPreloadState();
let switchResult = recordPreloadAttentionObservation(
  switchState,
  {
    tabId: 10,
    windowId: 10,
    pageUrl: "https://one.example/",
    observedAt: "2026-01-01T00:00:00.000Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
switchState = switchResult.preloadState;
switchResult = recordPreloadAttentionObservation(
  switchState,
  {
    tabId: 20,
    windowId: 10,
    pageUrl: "https://two.example/",
    observedAt: "2026-01-01T00:00:00.500Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
switchState = switchResult.preloadState;
assert.equal(switchResult.recordedDurationMs, 0);
assert.equal(
  switchState.scheduler.attentionPendingByKey["10\nhttps://one.example/"].durationMs,
  500
);
assert.equal(switchState.scheduler.activeTabCursor.pendingDurationMs, 0);
switchResult = recordPreloadAttentionObservation(
  switchState,
  {
    tabId: 10,
    windowId: 10,
    pageUrl: "https://one.example/",
    observedAt: "2026-01-01T00:00:01.000Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
switchState = switchResult.preloadState;
assert.equal(
  switchState.scheduler.attentionPendingByKey["20\nhttps://two.example/"].durationMs,
  500
);
assert.equal(switchState.scheduler.activeTabCursor.pendingDurationMs, 500);
switchResult = recordPreloadAttentionObservation(
  switchState,
  {
    tabId: 10,
    windowId: 10,
    pageUrl: "https://one.example/",
    observedAt: "2026-01-01T00:00:01.500Z",
    counting: true,
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 1000 }
);
switchState = switchResult.preloadState;
assert.equal(switchResult.recordedDurationMs, 1000);
assert.equal(switchState.scheduler.attentionPool.totalDurationMs, 1000);
assert.equal(switchState.scheduler.attentionPendingByKey["10\nhttps://one.example/"], undefined);
assert.equal(
  switchState.scheduler.attentionPendingByKey["20\nhttps://two.example/"].durationMs,
  500
);

let weightedState = context.createEmptyPreloadState();
let weightedResult = recordPreloadAttentionObservation(
  weightedState,
  {
    tabId: 4,
    windowId: 10,
    pageUrl: "https://media.example/",
    observedAt: "2026-01-01T00:00:00.000Z",
    counting: true,
    weight: 0.2,
    activityKind: "video-playback",
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 100 }
);
weightedState = weightedResult.preloadState;
weightedResult = recordPreloadAttentionObservation(
  weightedState,
  {
    tabId: 4,
    windowId: 10,
    pageUrl: "https://media.example/",
    observedAt: "2026-01-01T00:00:00.500Z",
    counting: true,
    weight: 0.2,
    activityKind: "video-playback",
  },
  { maxObservableGapMs: 1000, segmentDurationMs: 100 }
);
weightedState = weightedResult.preloadState;
assert.equal(weightedResult.recordedDurationMs, 100);
assert.equal(weightedState.scheduler.attentionPool.totalDurationMs, 100);

let expiringState = context.createEmptyPreloadState();
let expiringResult = recordPreloadAttentionObservation(
  expiringState,
  {
    tabId: 5,
    windowId: 10,
    pageUrl: "https://input.example/",
    observedAt: "2026-01-01T00:00:00.000Z",
    counting: true,
    weight: 1,
    activityKind: "user-input",
    expiresAt: "2026-01-01T00:01:00.000Z",
  },
  { maxObservableGapMs: 120000 }
);
expiringState = expiringResult.preloadState;
expiringResult = recordPreloadAttentionObservation(
  expiringState,
  {
    tabId: 5,
    windowId: 10,
    pageUrl: "https://input.example/",
    observedAt: "2026-01-01T00:01:15.000Z",
    counting: false,
  },
  { maxObservableGapMs: 120000 }
);
expiringState = expiringResult.preloadState;
assert.equal(expiringResult.recordedDurationMs, 60000);
assert.equal(expiringState.scheduler.attentionPool.totalDurationMs, 60000);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      resolveAttentionActivity(
        {
          observedAt: "2026-01-01T00:00:30.000Z",
          documentVisible: true,
          lastUserInputAt: "2026-01-01T00:00:00.000Z",
          videoPlaybackActive: true,
        },
        { inputWindowMs: 60000, mediaPlaybackWeight: 0.2, audioPlaybackWeight: 0.07 }
      )
    )
  ),
  {
    kind: "user-input",
    weight: 1,
    expiresAt: "2026-01-01T00:01:00.000Z",
  }
);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      resolveAttentionActivity(
        {
          observedAt: "2026-01-01T00:02:00.000Z",
          documentVisible: true,
          lastUserInputAt: "2026-01-01T00:00:00.000Z",
          videoPlaybackActive: true,
        },
        { inputWindowMs: 60000, mediaPlaybackWeight: 0.2, audioPlaybackWeight: 0.07 }
      )
    )
  ),
  {
    kind: "video-playback",
    weight: 0.2,
    expiresAt: null,
  }
);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      resolveAttentionActivity(
        {
          observedAt: "2026-01-01T00:02:00.000Z",
          documentVisible: true,
          lastUserInputAt: "2026-01-01T00:00:00.000Z",
          audioPlaybackActive: true,
        },
        { inputWindowMs: 60000, mediaPlaybackWeight: 0.2, audioPlaybackWeight: 0.07 }
      )
    )
  ),
  {
    kind: "audio-playback",
    weight: 0.07,
    expiresAt: null,
  }
);

preloadState.scheduler.attentionPool = appendPreloadAttentionDuration(
  preloadState.scheduler.attentionPool,
  {
    tabId: 2,
    windowId: 10,
    pageUrl: "https://example.org/b",
    durationMs: 1500,
    startedAt: "2026-01-01T00:00:03.000Z",
    endedAt: "2026-01-01T00:00:04.500Z",
  },
  { poolDurationMs: 5000 }
);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      computePreloadAttentionDwellShares(preloadState.scheduler.attentionPool, [
        { tabId: 1, pageUrl: "https://example.com/a" },
        { tabId: 2, pageUrl: "https://example.org/b" },
        { tabId: 3, pageUrl: "https://example.net/c" },
      ])
    )
  ),
  {
    1: 0.4,
    2: 0.6,
    3: 0,
  }
);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      computePreloadAttentionDwellShares(context.createEmptyPreloadSchedulerState().attentionPool, [
        { tabId: 9, pageUrl: "https://cold-start.example/" },
      ])
    )
  ),
  { 9: 1 }
);

console.log("preload scheduler attention tests passed");
