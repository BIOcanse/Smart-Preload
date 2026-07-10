import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const heartbeatDependencies = [
  ["extension", "background", "shared", "native-app", "request", "common.js"],
  [
    "extension",
    "background",
    "shared",
    "native-app",
    "request",
    "heartbeat",
    "throttle.js",
  ],
  [
    "extension",
    "background",
    "shared",
    "native-app",
    "request",
    "heartbeat",
    "alarms.js",
  ],
  [
    "extension",
    "background",
    "shared",
    "native-app",
    "request",
    "heartbeat",
    "wake.js",
  ],
  [
    "extension",
    "background",
    "shared",
    "native-app",
    "request",
    "heartbeat",
    "recovery.js",
  ],
  [
    "extension",
    "background",
    "shared",
    "native-app",
    "request",
    "heartbeat",
    "wake-retry.js",
  ],
  ["extension", "background", "shared", "native-app", "request", "heartbeat.js"],
].map((segments) => path.join(repoRoot, ...segments));

function createHarness(overrides = {}) {
  const records = [];
  const alarmCreates = [];
  const alarmClears = [];
  const lifecycleKeys = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Date,
    Math,
    Number,
    String,
    Promise,
    chrome: {
      alarms: {
        clear: async (alarmName) => {
          alarmClears.push(alarmName);
          return true;
        },
        create: async (alarmName, options) => {
          alarmCreates.push({ alarmName, options });
        },
      },
    },
    ZeroLatencyDebugEvents: {
      record: (eventName, payload = {}) => {
        records.push({ eventName, payload });
      },
    },
    ZeroLatencySupport: {
      hasChromeNamespaceMethod: (namespaceName, methodName) =>
        namespaceName === "alarms" && ["clear", "create"].includes(methodName),
      supportsSystemLevelWindowHiding: () => true,
      setSystemLevelWindowHidingUsable: () => {},
    },
    ZeroLatencyNativeAppWake: {
      wake: async () => ({ ok: true }),
    },
    invalidateNativeAppHealthCache: () => {},
    nativeAppHealthCheck: async () => false,
    queueLifecycle: async (key, task) => {
      lifecycleKeys.push(key);
      return task();
    },
    ...overrides,
  };
  context.globalThis = context;
  vm.createContext(context);

  vm.runInContext(readFileSync(heartbeatDependencies[0], "utf8"), context, {
    filename: heartbeatDependencies[0],
  });

  const modules = context.ZeroLatencyNativeAppRequestModules;
  Object.assign(modules, {
    collectNativeAppHeartbeatBrowserActivity: async () => ({
      clientId: "zlw:test",
      normalWindowCount: 1,
      normalTabCount: 1,
      preloadWindowHwnds: [],
    }),
    fetchNativeApp: async () => ({
      ok: true,
      activeLeaseCount: 1,
      activeNormalWindowCount: 1,
    }),
    ensureNativeAppRegistration: async () => ({}),
    resetNativeAppRegistration: () => {},
  });

  for (const dependencyPath of heartbeatDependencies.slice(1)) {
    vm.runInContext(readFileSync(dependencyPath, "utf8"), context, {
      filename: dependencyPath,
    });
  }

  return {
    context,
    modules,
    records,
    alarmCreates,
    alarmClears,
    lifecycleKeys,
  };
}

async function assertHeartbeatAlarmIsThrottled() {
  const { modules, records, lifecycleKeys } = createHarness();
  let fetchCount = 0;
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { ok: true, activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  const first = await modules.sendNativeAppHeartbeat("alarm");
  const second = await modules.sendNativeAppHeartbeat("alarm");

  assert.equal(first.activeLeaseCount, 1);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "throttled");
  assert.equal(fetchCount, 1);
  assert.deepEqual(lifecycleKeys, ["native-app-heartbeat"]);
  assert.ok(
    records.some((record) => record.eventName === "native-app.heartbeat.skip-throttled")
  );
}

async function assertHeartbeatRecoveryReasonIsNotThrottled() {
  const { modules } = createHarness();
  let fetchCount = 0;
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { ok: true, activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  await modules.sendNativeAppHeartbeat("alarm");
  const recovered = await modules.sendNativeAppHeartbeat("alarm:health-ok");

  assert.equal(recovered.activeLeaseCount, 1);
  assert.equal(fetchCount, 2);
}

async function assertRecoveryHasOneWakeAndOneRetry() {
  let wakeCount = 0;
  let fetchCount = 0;
  const { modules } = createHarness({
    ZeroLatencyNativeAppWake: {
      wake: async () => {
        wakeCount += 1;
        return { ok: true };
      },
    },
  });
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      throw new Error("offline");
    }
    return { ok: true, activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };
  const result = await modules.sendNativeAppHeartbeat("manual-recovery");

  assert.equal(result.activeLeaseCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(wakeCount, 1);
}

async function assertZeroWindowSendsLeaseReleaseWithoutWake() {
  let wakeCount = 0;
  const requestBodies = [];
  const { modules } = createHarness({
    ZeroLatencyNativeAppWake: {
      wake: async () => {
        wakeCount += 1;
        return { ok: true };
      },
    },
  });
  modules.collectNativeAppHeartbeatBrowserActivity = async () => ({
    clientId: "zlw:test",
    normalWindowCount: 0,
    normalTabCount: 0,
    preloadWindowHwnds: [],
  });
  modules.fetchNativeApp = async (_path, options) => {
    requestBodies.push(options.body);
    return { ok: true, activeLeaseCount: 0, activeNormalWindowCount: 0 };
  };

  const result = await modules.sendNativeAppHeartbeat("zero-window");

  assert.equal(result.activeLeaseCount, 0);
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0].normalWindowCount, 0);
  assert.equal(wakeCount, 0);
}

async function assertPackedAlarmPeriodIsClamped() {
  const { modules, alarmCreates } = createHarness();
  modules.NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS = 5;

  await modules.ensureNativeAppHeartbeatAlarm(true);

  assert.equal(alarmCreates.length, 1);
  assert.equal(alarmCreates[0].options.delayInMinutes, 0.5);
  assert.equal(alarmCreates[0].options.periodInMinutes, 0.5);
}

async function assertWakeRetryIsSingleAndThrottled() {
  let healthChecks = 0;
  let fetchCount = 0;
  const { modules, lifecycleKeys, alarmClears } = createHarness({
    nativeAppHealthCheck: async () => {
      healthChecks += 1;
      return true;
    },
  });
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { ok: true, activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  const first = await modules.runNativeAppWakeRetry("alarm");
  const second = await modules.runNativeAppWakeRetry("alarm");

  assert.equal(first.activeLeaseCount, 1);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "throttled");
  assert.equal(healthChecks, 1);
  assert.equal(fetchCount, 1);
  assert.deepEqual(lifecycleKeys, ["native-app-wake-retry"]);
  assert.ok(alarmClears.includes(modules.NATIVE_APP_WAKE_RETRY_ALARM));
}

await assertHeartbeatAlarmIsThrottled();
await assertHeartbeatRecoveryReasonIsNotThrottled();
await assertRecoveryHasOneWakeAndOneRetry();
await assertZeroWindowSendsLeaseReleaseWithoutWake();
await assertPackedAlarmPeriodIsClamped();
await assertWakeRetryIsSingleAndThrottled();

console.log("native-app heartbeat throttle tests passed");
