async function recordVisit(details, sourceEvent) {
  return globalThis.ZeroLatencyTrackingRuntime.recordVisit(details, sourceEvent);
}

async function setCurrentPageFromVisit(details, sourceEvent) {
  return globalThis.ZeroLatencyTrackingRuntime.setCurrentPageFromVisit(details, sourceEvent);
}

async function recordCreatedNavigationTarget(details) {
  return globalThis.ZeroLatencyTrackingRuntime.recordCreatedNavigationTarget(details);
}

async function recordTabReplacement(details) {
  return globalThis.ZeroLatencyTrackingRuntime.recordTabReplacement(details);
}
