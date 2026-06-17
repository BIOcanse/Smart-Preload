import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "background", "preload", "runtime", "policy", "performance-warning", "constants.js"],
  ["extension", "background", "preload", "runtime", "policy", "performance-warning", "normalize.js"],
  ["extension", "background", "preload", "runtime", "policy", "performance-warning", "pressure.js"],
  ["extension", "background", "preload", "runtime", "policy", "performance-warning", "samples.js"],
  ["extension", "background", "preload", "runtime", "policy", "performance-warning", "state.js"],
  ["extension", "background", "preload", "runtime", "policy", "performance-warning.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Number,
  Promise,
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};

vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

let activitySnapshot = {
  gameProcessRunning: false,
  professionalProcessRunning: false,
  nonChromeFullscreen: false,
};
let performanceSnapshot = buildPerformanceSnapshot({
  cpuUsagePercent: 20,
  memoryUsageRatio: 0.95,
  availableMemoryBytes: 512 * 1024 * 1024,
  gpuUsagePercent: 20,
});

context.nativeAppGetSystemActivitySnapshot = async () => activitySnapshot;
context.nativeAppGetSystemPerformanceSnapshot = async () => performanceSnapshot;

const warningApi = context.getPreloadPerformanceWarningState;

let warning = await warningApi({ forceRefresh: true });
assert.equal(warning.active, true);
assert.equal(warning.reason, "performance-insufficient");
assert.deepEqual(JSON.parse(JSON.stringify(warning.reasons)), ["memory"]);

activitySnapshot = {
  gameProcessRunning: false,
  professionalProcessRunning: true,
  professionalProcess: {
    processName: "blender.exe",
  },
  nonChromeFullscreen: false,
};
warning = await warningApi({ forceRefresh: true });
assert.equal(warning.active, false);
assert.equal(warning.reason, "external-workload");
assert.deepEqual(JSON.parse(JSON.stringify(warning.suppressedReasons)), ["memory"]);

performanceSnapshot = buildPerformanceSnapshot({
  cpuUsagePercent: 95,
  memoryUsageRatio: 0.4,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024,
  gpuUsagePercent: 20,
});
await warningApi({ forceRefresh: true });
await warningApi({ forceRefresh: true });
warning = await warningApi({ forceRefresh: true });
assert.equal(warning.active, false);
assert.equal(warning.reason, "external-workload");
assert.equal(warning.metrics.cpuHighSampleCount, 0);

activitySnapshot = {
  gameProcessRunning: false,
  professionalProcessRunning: false,
  nonChromeFullscreen: false,
};
performanceSnapshot = buildPerformanceSnapshot({
  cpuUsagePercent: 95,
  memoryUsageRatio: 0.4,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024,
  gpuUsagePercent: 20,
});
await warningApi({ forceRefresh: true });
await warningApi({ forceRefresh: true });
warning = await warningApi({ forceRefresh: true });
assert.equal(warning.active, true);
assert.deepEqual(JSON.parse(JSON.stringify(warning.reasons)), ["cpu"]);
assert.equal(warning.metrics.cpuHighSampleCount >= 3, true);

warning = await warningApi({ allowRefresh: false });
assert.equal(warning.active, true);
assert.deepEqual(JSON.parse(JSON.stringify(warning.reasons)), ["cpu"]);

performanceSnapshot = buildPerformanceSnapshot({
  cpuUsagePercent: 20,
  memoryUsageRatio: 0.4,
  availableMemoryBytes: 8 * 1024 * 1024 * 1024,
  gpuUsagePercent: 20,
  gpuDedicatedMemory: {
    usedBytes: 7700,
    limitBytes: 8192,
    availableBytes: 492,
    usageRatio: 0.94,
  },
});
warning = await warningApi({ forceRefresh: true });
assert.equal(warning.active, true);
assert.deepEqual(JSON.parse(JSON.stringify(warning.reasons)), ["vram", "cpu"]);

console.log("preload performance warning tests passed");

function buildPerformanceSnapshot({
  cpuUsagePercent,
  memoryUsageRatio,
  availableMemoryBytes,
  gpuUsagePercent,
  gpuDedicatedMemory = null,
}) {
  return {
    system: {
      cpuUsagePercent,
      memoryUsageRatio,
      availableMemoryBytes,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      gpuUsagePercent,
      gpuDedicatedMemory,
    },
  };
}
