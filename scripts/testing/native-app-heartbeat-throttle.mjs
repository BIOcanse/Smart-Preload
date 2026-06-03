import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const heartbeatPath = path.join(
  repoRoot,
  "extansion",
  "background",
  "shared",
  "native-app",
  "request",
  "heartbeat.js"
);
const heartbeatSource = readFileSync(heartbeatPath, "utf8");

function createHarness(overrides = {}) {
  const records = [];
  const modules = {
    NATIVE_APP_EXTENSION_HEARTBEAT_PATH: "/api/v1/extension/heartbeat",
    NATIVE_APP_HEARTBEAT_ALARM: "native-app-heartbeat",
    NATIVE_APP_HEARTBEAT_INTERVAL_SECONDS: 5,
    NATIVE_APP_HEARTBEAT_RECOVERY_DELAYS_MS: [0],
    NATIVE_APP_WAKE_RETRY_ALARM: "native-app-wake-retry",
    NATIVE_APP_WAKE_RETRY_INTERVAL_SECONDS: 5,
    collectNativeAppHeartbeatBrowserActivity: async () => ({
      clientId: "zlw:test",
      normalWindowCount: 1,
      normalTabCount: 1,
      preloadWindowHwnds: [],
    }),
    fetchNativeApp: async () => ({ activeLeaseCount: 1, activeNormalWindowCount: 1 }),
    markNativeAppSystemHidingAvailability: () => {},
    ensureNativeAppRegistration: async () => ({}),
    resetNativeAppRegistration: () => {},
  };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Number,
    String,
    Promise,
    ZeroLatencyNativeAppRequestModules: modules,
    ZeroLatencyDebugEvents: {
      record: (eventName, payload = {}) => {
        records.push({ eventName, payload });
      },
    },
    ZeroLatencySupport: {
      hasChromeNamespaceMethod: () => false,
    },
    ZeroLatencyNativeAppWake: {
      retryDelaysMs: [0],
      wake: async () => ({ ok: true }),
    },
    invalidateNativeAppHealthCache: () => {},
    nativeAppHealthCheck: async () => false,
    wait: async () => {},
    ...overrides,
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(heartbeatSource, context, { filename: heartbeatPath });

  return {
    context,
    modules,
    records,
  };
}

async function assertHeartbeatAlarmIsThrottled() {
  const { modules, records } = createHarness();
  let fetchCount = 0;
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  const first = await modules.sendNativeAppHeartbeat("alarm");
  const second = await modules.sendNativeAppHeartbeat("alarm");

  assert.equal(first.activeLeaseCount, 1);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "throttled");
  assert.equal(fetchCount, 1);
  assert.ok(
    records.some((record) => record.eventName === "native-app.heartbeat.skip-throttled")
  );
}

async function assertHeartbeatRecoveryReasonIsNotThrottled() {
  const { modules, records } = createHarness();
  let fetchCount = 0;
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  const first = await modules.sendNativeAppHeartbeat("alarm");
  const second = await modules.sendNativeAppHeartbeat("alarm:health-ok");

  assert.equal(first.activeLeaseCount, 1);
  assert.equal(second.activeLeaseCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(
    records.some(
      (record) =>
        record.eventName === "native-app.heartbeat.skip-throttled" &&
        record.payload?.reason === "alarm:health-ok"
    ),
    false
  );
}

async function assertWakeRetryAlarmIsThrottled() {
  let healthCheckCount = 0;
  let registrationResetCount = 0;
  const { modules, records } = createHarness({
    nativeAppHealthCheck: async () => {
      healthCheckCount += 1;
      return true;
    },
  });
  let fetchCount = 0;
  modules.resetNativeAppRegistration = () => {
    registrationResetCount += 1;
  };
  modules.fetchNativeApp = async () => {
    fetchCount += 1;
    return { activeLeaseCount: 1, activeNormalWindowCount: 1 };
  };

  const first = await modules.runNativeAppWakeRetry("alarm");
  const second = await modules.runNativeAppWakeRetry("alarm");

  assert.equal(first.activeLeaseCount, 1);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "throttled");
  assert.equal(healthCheckCount, 1);
  assert.equal(registrationResetCount, 1);
  assert.equal(fetchCount, 1);
  assert.ok(
    records.some((record) => record.eventName === "native-app.wake-retry.skip-throttled")
  );
}

async function assertWakeRetryHealthOkClearsAlarm() {
  const alarmClears = [];
  const { modules } = createHarness({
    chrome: {
      alarms: {
        clear: async (alarmName) => {
          alarmClears.push(alarmName);
        },
        create: async () => {},
      },
    },
    ZeroLatencySupport: {
      hasChromeNamespaceMethod: (namespaceName, methodName) =>
        namespaceName === "alarms" && ["clear", "create"].includes(methodName),
    },
    nativeAppHealthCheck: async () => true,
  });

  const result = await modules.runNativeAppWakeRetry("alarm:manual");

  assert.equal(result.activeLeaseCount, 1);
  assert.ok(alarmClears.includes(modules.NATIVE_APP_WAKE_RETRY_ALARM));
}

await assertHeartbeatAlarmIsThrottled();
await assertHeartbeatRecoveryReasonIsNotThrottled();
await assertWakeRetryAlarmIsThrottled();
await assertWakeRetryHealthOkClearsAlarm();

console.log("native-app heartbeat throttle tests passed");
