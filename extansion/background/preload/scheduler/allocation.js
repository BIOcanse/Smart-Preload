(function () {
  const { resolveAsymptoticPreloadCap } =
    globalThis.ZeroLatencyPreloadSchedulerCapAllocation;
  const { allocateTabPreloadSlots } =
    globalThis.ZeroLatencyPreloadSchedulerSlotAllocation;

  globalThis.ZeroLatencyPreloadSchedulerAllocation = {
    resolveAsymptoticPreloadCap,
    allocateTabPreloadSlots,
  };
})();
