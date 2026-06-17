(function () {
  const {
    applyPreloadSchedulerCandidateSelection,
  } = globalThis.ZeroLatencyPreloadSchedulerSelectionsApply;
  const {
    rescheduleStoredPreloadSelections,
  } = globalThis.ZeroLatencyPreloadSchedulerSelectionsReschedule;

  globalThis.ZeroLatencyPreloadSchedulerSelections = {
    applyPreloadSchedulerCandidateSelection,
    rescheduleStoredPreloadSelections,
    buildSchedulerDiscoverySlotLimits,
    schedulePreloadCandidateSelectionSnapshots,
    buildSelectionFromTargets,
    notifyScheduledSourceTabs,
  };
})();
