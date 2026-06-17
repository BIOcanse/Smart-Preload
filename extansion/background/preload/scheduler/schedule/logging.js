function countSelectionTargets(selection) {
  return {
    selected: Array.isArray(selection?.selectedTargets)
      ? selection.selectedTargets.length
      : 0,
    hiddenTab: Array.isArray(selection?.tabTargets) ? selection.tabTargets.length : 0,
    prerender: Array.isArray(selection?.prerenderTargets)
      ? selection.prerenderTargets.length
      : 0,
    prefetch: Array.isArray(selection?.prefetchTargets)
      ? selection.prefetchTargets.length
      : 0,
  };
}

function recordSchedulerEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}

globalThis.ZeroLatencyPreloadSchedulerScheduleLogging = {
  countSelectionTargets,
  recordSchedulerEvent,
};
