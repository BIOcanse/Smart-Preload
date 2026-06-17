(function () {
  const {
    normalizeTabAllocationInputs,
    buildTabSlotAllocation,
  } = globalThis.ZeroLatencyPreloadSchedulerSlotInput;
  const {
    buildInitialSlotAllocationStates,
    redistributeSlotFractionsFromLowToHigh,
    reconcileSlotAllocationStates,
    findAllocationState,
  } = globalThis.ZeroLatencyPreloadSchedulerSlotState;

  function allocateTabPreloadSlots({ totalCap, tabs } = {}) {
    const normalizedTotalCap = Math.max(0, Math.trunc(Number(totalCap) || 0));
    const normalizedTabs = normalizeTabAllocationInputs(tabs);

    if (normalizedTotalCap <= 0 || normalizedTabs.length === 0) {
      return normalizedTabs.map((tab) => buildTabSlotAllocation(tab, 0, 0));
    }

    const usableTotalCap = normalizedTabs.reduce((sum, tab) => sum + tab.cap, 0);
    const targetTotalCap = Math.min(normalizedTotalCap, usableTotalCap);

    if (targetTotalCap <= 0) {
      return normalizedTabs.map((tab) => buildTabSlotAllocation(tab, 0, 0));
    }

    const allocationStates = buildInitialSlotAllocationStates(
      normalizedTabs,
      targetTotalCap
    );

    redistributeSlotFractionsFromLowToHigh(allocationStates);
    reconcileSlotAllocationStates(allocationStates, targetTotalCap);

    return normalizedTabs.map((tab) => {
      const state = findAllocationState(allocationStates, tab.key);
      return buildTabSlotAllocation(tab, state?.rawSlots || 0, state?.slots || 0);
    });
  }

  globalThis.ZeroLatencyPreloadSchedulerSlotAllocation = {
    allocateTabPreloadSlots,
  };
})();
