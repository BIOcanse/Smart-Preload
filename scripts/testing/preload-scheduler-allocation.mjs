import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scoringScriptPaths = [
  ["extansion", "background", "preload", "scoring", "constants.js"],
  ["extansion", "background", "preload", "scoring", "multipliers.js"],
  ["extansion", "background", "preload", "scoring.js"],
].map((segments) => path.join(repoRoot, ...segments));
const allocationPath = path.join(
  repoRoot,
  "extansion",
  "background",
  "preload",
  "scheduler",
  "allocation.js"
);
const allocationScriptPaths = [
  path.join(
    repoRoot,
    "extansion",
    "background",
    "preload",
    "scheduler",
    "allocation",
    "constants.js"
  ),
  path.join(
    repoRoot,
    "extansion",
    "background",
    "preload",
    "scheduler",
    "allocation",
    "cap.js"
  ),
  path.join(
    repoRoot,
    "extansion",
    "background",
    "preload",
    "scheduler",
    "allocation",
    "slot-input.js"
  ),
  path.join(
    repoRoot,
    "extansion",
    "background",
    "preload",
    "scheduler",
    "allocation",
    "slot-state.js"
  ),
  path.join(
    repoRoot,
    "extansion",
    "background",
    "preload",
    "scheduler",
    "allocation",
    "slots.js"
  ),
  allocationPath,
];

const context = {
  console,
  Math,
  Number,
  Date,
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scoringScriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}
for (const scriptPath of allocationScriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const { resolveAsymptoticPreloadCap, allocateTabPreloadSlots } =
  context.ZeroLatencyPreloadSchedulerAllocation;

assert.equal(resolveAsymptoticPreloadCap({ tabCount: 1, minCap: 3, maxCap: 15, halfLifeTabs: 4 }), 3);
assert.equal(resolveAsymptoticPreloadCap({ tabCount: 1, minCap: 7, maxCap: 7, halfLifeTabs: 4 }), 7);
assert.ok(
  resolveAsymptoticPreloadCap({ tabCount: 20, minCap: 3, maxCap: 15, halfLifeTabs: 4 }) >
    resolveAsymptoticPreloadCap({ tabCount: 4, minCap: 3, maxCap: 15, halfLifeTabs: 4 })
);
assert.ok(
  resolveAsymptoticPreloadCap({ tabCount: 200, minCap: 3, maxCap: 15, halfLifeTabs: 4 }) <= 15
);

assert.ok(Math.abs(context.buildTransitionFrequencyScoreMultiplier(1) - 1.3228085792519313) < 1e-12);
assert.notEqual(
  context.buildFrequencyLikeScoreMultiplier(1.9),
  context.buildTransitionFrequencyScoreMultiplier(1.9)
);
assert.ok(context.buildFrequencyLikeScoreMultiplier(1.9) > context.buildTransitionFrequencyScoreMultiplier(1.9));
assert.equal(context.buildSchedulerLinkValueMultiplier(0), 1);
assert.ok(context.buildSchedulerLinkValueMultiplier(1000) > 3);
assert.ok(
  context.buildSchedulerLinkValueMultiplier(1000000) >
    context.buildSchedulerLinkValueMultiplier(1000)
);

assert.deepEqual(
  allocateTabPreloadSlots({
    totalCap: 5,
    tabs: [
      { tabId: 1, score: 10, cap: 99 },
      { tabId: 2, score: 1, cap: 99 },
    ],
  }).map((item) => [item.tabId, item.slots]),
  [
    [1, 5],
    [2, 0],
  ]
);

assert.deepEqual(
  allocateTabPreloadSlots({
    totalCap: 5,
    tabs: [
      { tabId: 1, score: 3, cap: 99 },
      { tabId: 2, score: 2, cap: 99 },
      { tabId: 3, score: 1, cap: 99 },
    ],
  }).map((item) => [item.tabId, Number(item.rawSlots.toFixed(3)), item.slots]),
  [
    [1, 2.5, 3],
    [2, 1.667, 2],
    [3, 0.833, 0],
  ]
);

assert.deepEqual(
  allocateTabPreloadSlots({
    totalCap: 5,
    tabs: [
      { tabId: 1, score: 10, cap: 3 },
      { tabId: 2, score: 1, cap: 99 },
    ],
  }).map((item) => [item.tabId, item.slots]),
  [
    [1, 3],
    [2, 2],
  ]
);

assert.deepEqual(
  allocateTabPreloadSlots({
    totalCap: 2,
    tabs: [
      { tabId: 1, score: 1, cap: 1, active: false },
      { tabId: 2, score: 1, cap: 1, active: true },
      { tabId: 3, score: 0.1, cap: 1 },
    ],
  }).map((item) => [item.tabId, item.slots]),
  [
    [1, 1],
    [2, 1],
    [3, 0],
  ]
);

console.log("preload scheduler allocation tests passed");
