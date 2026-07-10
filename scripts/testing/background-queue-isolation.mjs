import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scripts = [
  ["extension", "background", "core", "state", "queues", "serial.js"],
  ["extension", "background", "core", "state", "queues", "coalescing.js"],
  ["extension", "background", "core", "state", "queues", "priority.js"],
  ["extension", "background", "core", "state", "queues.js"],
  ["extension", "background", "core", "state", "container.js"],
].map((segments) => path.join(repoRoot, ...segments));
let releaseHydration;
const hydrationBlocked = new Promise((resolve) => {
  releaseHydration = resolve;
});
const context = {
  console,
  Promise,
  Map,
  Set,
  String,
  TypeError,
  createBackgroundStateKeys: () => ({}),
  createBackgroundStateConstants: () => ({}),
  createEmptyTrackingGraphSummary: () => ({}),
  createEmptyPreloadState: () => ({}),
  createDefaultServiceState: () => ({}),
  normalizeTrackingGraphSummary: (value) => value ?? {},
  normalizeTrackingTabStateMap: (value) => value ?? {},
  normalizePreloadState: (value) => value ?? {},
  normalizeServiceState: (value) => value ?? {},
  initializeExtensionStateForBackgroundState: async () => hydrationBlocked,
};
context.globalThis = context;
vm.createContext(context);

for (const script of scripts) {
  vm.runInContext(readFileSync(script, "utf8"), context, { filename: script });
}

const queues = context.ZeroLatencyBackgroundTaskQueues.create();
let releaseLifecycle;
const lifecycleBlocked = new Promise((resolve) => {
  releaseLifecycle = resolve;
});
let lifecycleStarted = false;
let interactionFinished = false;

const lifecycleTask = queues.lifecycle.enqueue("native-heartbeat", async () => {
  lifecycleStarted = true;
  await lifecycleBlocked;
  return "heartbeat-finished";
});

while (!lifecycleStarted) {
  await Promise.resolve();
}

await queues.mutation.enqueue(async () => {
  interactionFinished = true;
}, { priority: "high" });
assert.equal(interactionFinished, true);

const priorityRuns = [];
let releaseMutationBlocker;
const mutationBlocked = new Promise((resolve) => {
  releaseMutationBlocker = resolve;
});
const mutationBlocker = queues.mutation.enqueue(async () => {
  priorityRuns.push("running-normal");
  await mutationBlocked;
});
await Promise.resolve();
const queuedNormal = queues.mutation.enqueue(async () => {
  priorityRuns.push("queued-normal");
});
const queuedHigh = queues.mutation.enqueue(async () => {
  priorityRuns.push("queued-high");
}, { priority: "high" });
releaseMutationBlocker();
await Promise.all([mutationBlocker, queuedNormal, queuedHigh]);
assert.deepEqual(priorityRuns, ["running-normal", "queued-high", "queued-normal"]);

const candidateRuns = [];
let releaseFirstCandidate;
const firstCandidateBlocked = new Promise((resolve) => {
  releaseFirstCandidate = resolve;
});
const firstCandidate = queues.candidate.enqueue("tab:7", async () => {
  candidateRuns.push("first");
  await firstCandidateBlocked;
  return "first";
});
await Promise.resolve();
const replacedCandidate = queues.candidate.enqueue("tab:7", async () => {
  candidateRuns.push("replaced");
  return "replaced";
});
const latestCandidate = queues.candidate.enqueue("tab:7", async () => {
  candidateRuns.push("latest");
  return "latest";
});

assert.equal(replacedCandidate, latestCandidate);
releaseFirstCandidate();
assert.equal(await firstCandidate, "first");
assert.equal(await latestCandidate, "latest");
assert.deepEqual(candidateRuns, ["first", "latest"]);

const aiRuns = [];
let releaseAiBlocker;
const aiBlocked = new Promise((resolve) => {
  releaseAiBlocker = resolve;
});
const aiBlocker = queues.ai.enqueue("blocker", async () => {
  await aiBlocked;
});
await Promise.resolve();
const firstAi = queues.ai.enqueue("tab:7:page-a", async () => {
  aiRuns.push("old");
  return "old";
});
const latestAi = queues.ai.enqueue("tab:7:page-a", async () => {
  aiRuns.push("latest");
  return "latest";
});
releaseAiBlocker();
await aiBlocker;
assert.equal(await firstAi, "latest");
assert.equal(await latestAi, "latest");
assert.deepEqual(aiRuns, ["latest"]);

releaseLifecycle();
assert.equal(await lifecycleTask, "heartbeat-finished");

const backgroundState = new context.ZeroLatencyBackgroundState({
  settingsApi: {
    DEFAULT_SETTINGS: {},
    cloneSettings: (value) => value,
    normalizeStoredSettings: (value) => value ?? {},
    resolveEffectiveSettings: (value) => value,
  },
  chromeStorage: {},
});
let hydrationReady = false;
void backgroundState.whenReady().then(() => {
  hydrationReady = true;
});
const initialization = backgroundState.initializeExtensionState();
await Promise.resolve();
assert.equal(hydrationReady, false);
releaseHydration();
await initialization;
await backgroundState.whenReady();
assert.equal(hydrationReady, true);

console.log("background queue isolation tests passed");
