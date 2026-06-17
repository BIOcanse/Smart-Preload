import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "preload", "prediction", "site-selection", "clusters", "grouping.js"],
  ["extansion", "background", "preload", "prediction", "site-selection", "clusters", "scoring.js"],
  ["extansion", "background", "preload", "prediction", "site-selection", "clusters", "fallback.js"],
  ["extansion", "background", "preload", "prediction", "site-selection", "clusters.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
  normalizePageUrlForIndex(rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
  },
  comparePreloadCandidatePriority(left, right) {
    return (right.score || 0) - (left.score || 0);
  },
  buildTransitionFrequencyScoreMultiplier(value) {
    return 1 + Math.log1p(Number(value) || 0);
  },
  buildPreloadCandidateBaseScore() {
    return 1;
  },
  async scorePreloadCandidatesBatch(inputs) {
    return inputs.map((input) => ({
      normalizedScore: input.multipliers.reduce(
        (product, multiplier) => product * multiplier,
        input.baseScore
      ),
    }));
  },
  allocateSelectedSitePageSlots(totalSlots, weights, caps) {
    const slots = new Array(weights.length).fill(0);
    let remaining = totalSlots;
    const order = weights
      .map((weight, index) => ({ weight, index }))
      .sort((left, right) => right.weight - left.weight);

    for (const item of order) {
      if (remaining <= 0) {
        break;
      }

      const assigned = Math.min(caps[item.index], remaining);
      slots[item.index] = assigned;
      remaining -= assigned;
    }

    return slots;
  },
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const candidatePool = [
  { url: "https://same.test/a", nodeId: "https://same.test", isSameSite: true, score: 10 },
  {
    url: "https://site-a.test/a",
    targetPageUrl: "https://site-a.test/a",
    nodeId: "https://site-a.test",
    siteTransitionCount: 3,
    score: 5,
  },
  {
    url: "https://site-a.test/b",
    targetPageUrl: "https://site-a.test/b",
    nodeId: "https://site-a.test",
    siteTransitionCount: 3,
    score: 4,
  },
  {
    url: "https://site-b.test/a",
    targetPageUrl: "https://site-b.test/a",
    nodeId: "https://site-b.test",
    siteTransitionCount: 1,
    score: 8,
  },
];
const clusters = context.buildCrossSiteCandidateSiteClusters(
  candidatePool.filter((candidate) => !candidate.isSameSite)
);
assert.equal(clusters.length, 2);
assert.equal(clusters[0].nodeId, "https://site-a.test");
assert.equal(clusters[0].cap, 2);

const selected = await context.applySiteSelectionToCandidateGroupFallback(
  candidatePool,
  {
    pageSlotLimit: 3,
    siteSelectionLimit: 2,
    selectionGroup: "native",
  },
  clusters,
  new Map([["https://site-b.test", { multiplier: 3, matchedKeywords: ["b"] }]])
);
assert.equal(selected.length, 3);
assert.equal(selected[0].url, "https://same.test/a");
assert.ok(selected.some((candidate) => candidate.siteSelection?.selectionGroup === "native"));
assert.ok(selected.some((candidate) => candidate.siteSelection?.aiKeywordMatch));

console.log("site selection cluster tests passed");
