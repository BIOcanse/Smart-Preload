import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "preload", "runtime", "policy", "watchdog", "preflight.js"],
  [
    "extansion",
    "background",
    "preload",
    "runtime",
    "policy",
    "watchdog",
    "heartbeat-pressure.js",
  ],
  ["extansion", "background", "preload", "runtime", "policy", "watchdog", "maintenance.js"],
  ["extansion", "background", "preload", "runtime", "policy", "watchdog.js"],
].map((segments) => path.join(repoRoot, ...segments));

const counters = {
  load: 0,
  save: 0,
  nativeCleanup: 0,
  pressure: 0,
  perfRefresh: 0,
  maintain: 0,
};
const settings = {
  preloading: {
    enabled: true,
  },
  preloadWindow: {
    watchdogEnabled: true,
  },
};
let supportEnabled = true;
let servicePaused = false;
let nativeOnlyMode = false;
let pressureResult = {
  handled: false,
  didMutate: false,
};
let heartbeatVerdicts = {
  resourcePressure: {
    ok: true,
    state: null,
  },
  performanceWarning: {
    ok: true,
    state: null,
  },
};
let maintenanceMutated = false;

const context = {
  console,
  Date,
  Promise,
  setTimeout,
  clearTimeout,
  getEffectiveExtensionSettings: () => settings,
  isExtensionServicePaused: async () => servicePaused,
  loadPreloadState: async () => {
    counters.load += 1;
    return {
      normalWindowsById: {},
    };
  },
  savePreloadState: async () => {
    counters.save += 1;
  },
  applyPreloadResourcePressurePolicy: async (_preloadState, _settings, _manager, options) => {
    counters.pressure += 1;
    assert.equal(options.pressureState, heartbeatVerdicts?.resourcePressure?.state ?? null);
    return pressureResult;
  },
  getPreloadPerformanceWarningState: async () => {
    counters.perfRefresh += 1;
    return {};
  },
  maintainPreloadWindowsForWatchdog: async () => {
    counters.maintain += 1;
    return maintenanceMutated;
  },
  ZeroLatencyDebugEvents: {
    events: [],
    record(name, payload) {
      this.events.push({ name, payload });
    },
  },
  ZeroLatencySupport: {
    supportsHiddenTabPreloadRuntime: () => supportEnabled,
  },
  ZeroLatencyPreloadWindowManager: {
    id: "manager",
  },
  ZeroLatencyPreloadNativeOnlyPolicy: {
    isAllNativePreloadModeEnabled: () => nativeOnlyMode,
    clearHiddenTabPreloadStateForNativeOnlyMode: async (preloadState, runtimeSettings, options) => {
      counters.nativeCleanup += 1;
      assert.equal(preloadState.normalWindowsById instanceof Object, true);
      assert.equal(runtimeSettings, settings);
      assert.equal(options.reason, "watchdog");
      return {
        mutated: true,
        preloadState,
      };
    },
  },
  ZeroLatencyPreloadHeartbeat: {
    collectVerdicts: async (runtimeSettings, options) => {
      assert.equal(runtimeSettings, settings);
      assert.equal(options.performanceWarning.requireCachedAvailability, true);
      assert.equal(options.performanceWarning.timeoutMs, 1000);
      return heartbeatVerdicts;
    },
  },
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

function resetCounters() {
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
  context.ZeroLatencyDebugEvents.events.length = 0;
  supportEnabled = true;
  servicePaused = false;
  nativeOnlyMode = false;
  settings.preloading.enabled = true;
  settings.preloadWindow.watchdogEnabled = true;
  pressureResult = {
    handled: false,
    didMutate: false,
  };
  heartbeatVerdicts = {
    resourcePressure: {
      ok: true,
      state: null,
    },
    performanceWarning: {
      ok: true,
      state: null,
    },
  };
  maintenanceMutated = false;
}

resetCounters();
supportEnabled = false;
await context.enforcePreloadWindowPolicy();
assert.equal(counters.load, 0);
assert.equal(counters.pressure, 0);
assert.equal(counters.maintain, 0);

resetCounters();
nativeOnlyMode = true;
await context.enforcePreloadWindowPolicy();
assert.equal(counters.load, 1);
assert.equal(counters.nativeCleanup, 1);
assert.equal(counters.save, 1);
assert.equal(counters.pressure, 0);
assert.equal(counters.maintain, 0);

resetCounters();
heartbeatVerdicts = {
  resourcePressure: {
    ok: true,
    state: {
      shouldDeferHiddenTabs: true,
      policy: "sleep",
    },
  },
  performanceWarning: {
    ok: false,
    error: "cached snapshot unavailable",
  },
};
pressureResult = {
  handled: true,
  didMutate: true,
};
await context.enforcePreloadWindowPolicy();
assert.equal(counters.pressure, 1);
assert.equal(counters.save, 1);
assert.equal(counters.perfRefresh, 1);
assert.equal(counters.maintain, 0);

resetCounters();
settings.preloadWindow.watchdogEnabled = false;
await context.enforcePreloadWindowPolicy();
assert.equal(counters.pressure, 1);
assert.equal(counters.maintain, 0);
assert.equal(counters.save, 0);

resetCounters();
maintenanceMutated = true;
await context.enforcePreloadWindowPolicy();
assert.equal(counters.pressure, 1);
assert.equal(counters.maintain, 1);
assert.equal(counters.save, 1);

console.log("preload watchdog policy tests passed");
