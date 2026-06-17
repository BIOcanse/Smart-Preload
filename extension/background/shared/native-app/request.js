const ZeroLatencyNativeAppRequestModules = globalThis.ZeroLatencyNativeAppRequestModules;

async function fetchNativeApp(path, options = {}) {
  return ZeroLatencyNativeAppRequestModules.fetchNativeApp(path, options);
}

async function ensureNativeAppRegistration() {
  return ZeroLatencyNativeAppRequestModules.ensureNativeAppRegistration();
}

async function sendNativeAppHeartbeat(reason = "alarm") {
  return ZeroLatencyNativeAppRequestModules.sendNativeAppHeartbeat(reason);
}

async function runNativeAppWakeRetry(reason = "alarm") {
  return ZeroLatencyNativeAppRequestModules.runNativeAppWakeRetry(reason);
}

async function collectNativeAppHeartbeatBrowserActivity() {
  return ZeroLatencyNativeAppRequestModules.collectNativeAppHeartbeatBrowserActivity();
}

async function ensureNativeAppHeartbeatAlarm(enabled) {
  return ZeroLatencyNativeAppRequestModules.ensureNativeAppHeartbeatAlarm(enabled);
}

async function ensureNativeAppWakeRetryAlarm(enabled) {
  return ZeroLatencyNativeAppRequestModules.ensureNativeAppWakeRetryAlarm(enabled);
}

function isNativeAppHeartbeatAlarm(alarmName) {
  return ZeroLatencyNativeAppRequestModules.isNativeAppHeartbeatAlarm(alarmName);
}

function isNativeAppWakeRetryAlarm(alarmName) {
  return ZeroLatencyNativeAppRequestModules.isNativeAppWakeRetryAlarm(alarmName);
}

function buildNativeAppHeaders() {
  return ZeroLatencyNativeAppRequestModules.buildNativeAppHeaders();
}

function getExtensionOrigin() {
  return ZeroLatencyNativeAppRequestModules.getExtensionOrigin();
}

globalThis.ZeroLatencyNativeAppHeartbeat = {
  alarmName: ZeroLatencyNativeAppRequestModules.NATIVE_APP_HEARTBEAT_ALARM,
  wakeAlarmName: ZeroLatencyNativeAppRequestModules.NATIVE_APP_WAKE_RETRY_ALARM,
  ensureAlarm: ensureNativeAppHeartbeatAlarm,
  ensureWakeRetryAlarm: ensureNativeAppWakeRetryAlarm,
  send: sendNativeAppHeartbeat,
  runWakeRetry: runNativeAppWakeRetry,
  isAlarm: isNativeAppHeartbeatAlarm,
  isWakeRetryAlarm: isNativeAppWakeRetryAlarm,
};
