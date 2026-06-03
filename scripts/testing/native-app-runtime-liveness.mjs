import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const runtimeActionsPath = path.join(repoRoot, "extansion", "background", "actions", "runtime.js");
const runtimeActionsSource = readFileSync(runtimeActionsPath, "utf8");

function createHarness({ preloadingEnabled = true, servicePaused = false } = {}) {
  const calls = [];
  const context = {
    console,
    SETTINGS_STORAGE_KEY: "settings",
    backgroundState: {
      setCachedSettings: () => {},
    },
    initializeExtensionState: async () => calls.push("initializeExtensionState"),
    getEffectiveExtensionSettings: () => ({
      preloading: {
        enabled: preloadingEnabled,
      },
    }),
    isExtensionServicePaused: async () => servicePaused,
    ensurePreloadWindowWatchdog: async () => calls.push("ensurePreloadWindowWatchdog"),
    resetPreloads: async () => calls.push("resetPreloads"),
    requestPreloadCandidateRefreshForOpenTabs: async () =>
      calls.push("requestPreloadCandidateRefreshForOpenTabs"),
    ZeroLatencyDiagnostics: {
      configureFromSettings: () => calls.push("configureDiagnostics"),
    },
    ZeroLatencySupport: {
      probeNativeAppAvailability: async () => {
        calls.push("probeNativeAppAvailability");
        return false;
      },
    },
    ZeroLatencyNativeAppHeartbeat: {
      ensureAlarm: async (enabled) => calls.push(`heartbeatAlarm:${enabled}`),
      send: async (reason) => calls.push(`heartbeatSend:${reason}`),
    },
    ZeroLatencyAiProviders: {
      unloadConfiguredLmStudioModel: async (_settings, reason) =>
        calls.push(`unloadLmStudio:${reason}`),
      ensureLmStudioLifecycleWatchdog: async (_settings, options = {}) =>
        calls.push(`lmStudioWatchdog:${options.forceDisabled === true}`),
    },
    ZeroLatencyPreloadRuntimeManager: {
      ensureWarmWindows: async () => calls.push("ensureWarmWindows"),
      maintain: async () => calls.push("maintainPreloads"),
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(runtimeActionsSource, context, { filename: runtimeActionsPath });
  return { context, calls };
}

async function assertPreloadingDisabledKeepsNativeAppLiveness() {
  const { context, calls } = createHarness({ preloadingEnabled: false });

  await context.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();

  assert.ok(calls.includes("probeNativeAppAvailability"));
  assert.ok(calls.includes("heartbeatSend:runtime-settings"));
  assert.ok(calls.includes("heartbeatAlarm:true"));
  assert.ok(
    calls.indexOf("heartbeatAlarm:true") < calls.indexOf("probeNativeAppAvailability")
  );
  assert.ok(
    calls.indexOf("heartbeatSend:runtime-settings") <
      calls.indexOf("probeNativeAppAvailability")
  );
  assert.ok(calls.includes("unloadLmStudio:preloading-disabled"));
  assert.ok(calls.includes("resetPreloads"));
  assert.equal(calls.includes("ensureWarmWindows"), false);
  assert.equal(calls.includes("maintainPreloads"), false);
}

async function assertServicePausedStopsNativeAppLiveness() {
  const { context, calls } = createHarness({ preloadingEnabled: true, servicePaused: true });

  await context.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();

  assert.ok(calls.includes("heartbeatAlarm:false"));
  assert.ok(calls.includes("unloadLmStudio:service-paused"));
  assert.equal(calls.includes("heartbeatSend:runtime-settings"), false);
  assert.equal(calls.includes("probeNativeAppAvailability"), false);
}

await assertPreloadingDisabledKeepsNativeAppLiveness();
await assertServicePausedStopsNativeAppLiveness();

console.log("native-app runtime liveness tests passed");
