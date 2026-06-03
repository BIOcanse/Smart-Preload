(function () {
  const SLOT_ALLOCATION_EPSILON = 1e-9;
  const DEFAULT_PRELOAD_CAP_GROWTH_TABS = 8;

  function resolveAsymptoticPreloadCap({
    tabCount,
    minCap,
    maxCap,
    halfLifeTabs,
    growthTabs = DEFAULT_PRELOAD_CAP_GROWTH_TABS,
  } = {}) {
    const normalizedMinCap = normalizeSchedulerCap(minCap, 0);
    const normalizedMaxCap = Math.max(normalizedMinCap, normalizeSchedulerCap(maxCap, normalizedMinCap));
    const normalizedTabCount = Math.max(1, Math.trunc(Number(tabCount) || 1));
    const normalizedGrowthTabs = Math.max(
      1,
      Number(halfLifeTabs ?? growthTabs) || DEFAULT_PRELOAD_CAP_GROWTH_TABS
    );

    if (normalizedMinCap === normalizedMaxCap) {
      return normalizedMinCap;
    }

    const rawCap =
      normalizedMaxCap -
      (normalizedMaxCap - normalizedMinCap) *
        2 ** (-(normalizedTabCount - 1) / normalizedGrowthTabs);

    return Math.min(
      normalizedMaxCap,
      Math.max(normalizedMinCap, Math.round(rawCap))
    );
  }

  function normalizeSchedulerCap(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.max(0, Math.trunc(numericValue));
  }

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

    const scoreSum = normalizedTabs.reduce((sum, tab) => sum + tab.score, 0);
    const allocationStates = normalizedTabs.map((tab) => {
      const rawSlots = scoreSum > 0 ? (targetTotalCap * tab.score) / scoreSum : 0;
      const rawSlotFloor = Math.floor(rawSlots + SLOT_ALLOCATION_EPSILON);
      const baseSlots = Math.min(tab.cap, rawSlotFloor);
      const fraction =
        baseSlots < tab.cap ? Math.max(0, rawSlots - rawSlotFloor) : 0;

      return {
        ...tab,
        rawSlots,
        slots: baseSlots,
        fraction,
      };
    });
    const lowToHighStates = [...allocationStates].sort(compareAllocationStateLowToHigh);

    for (let index = 0; index < lowToHighStates.length; index += 1) {
      const state = lowToHighStates[index];
      const fraction = state.fraction;

      if (fraction <= SLOT_ALLOCATION_EPSILON) {
        continue;
      }

      state.fraction = 0;
      const higherStates = lowToHighStates.slice(index + 1);
      const undistributedFraction = redistributeSlotFraction(fraction, higherStates);

      if (undistributedFraction > SLOT_ALLOCATION_EPSILON) {
        addSlotFraction(state, undistributedFraction);
      }
    }

    reconcileSlotAllocationStates(allocationStates, targetTotalCap);

    return normalizedTabs.map((tab) =>
      buildTabSlotAllocation(
        tab,
        findAllocationState(allocationStates, tab.key)?.rawSlots || 0,
        findAllocationState(allocationStates, tab.key)?.slots || 0
      )
    );
  }

  function redistributeSlotFraction(fraction, states) {
    let pendingFraction = Number(fraction) || 0;

    while (pendingFraction > SLOT_ALLOCATION_EPSILON) {
      const recipients = states.filter(hasAllocationStateCapacity);

      if (recipients.length === 0) {
        return pendingFraction;
      }

      const scoreSum = recipients.reduce((sum, state) => sum + state.score, 0);

      if (scoreSum <= 0) {
        return pendingFraction;
      }

      let overflow = 0;

      for (const recipient of recipients) {
        overflow += addSlotFraction(recipient, pendingFraction * (recipient.score / scoreSum));
      }

      if (overflow <= SLOT_ALLOCATION_EPSILON) {
        return 0;
      }

      if (overflow >= pendingFraction - SLOT_ALLOCATION_EPSILON) {
        return overflow;
      }

      pendingFraction = overflow;
    }

    return 0;
  }

  function addSlotFraction(state, fraction) {
    let overflow = 0;

    if (!hasAllocationStateCapacity(state)) {
      return Math.max(0, Number(fraction) || 0);
    }

    state.fraction += Math.max(0, Number(fraction) || 0);

    while (
      state.fraction >= 1 - SLOT_ALLOCATION_EPSILON &&
      hasAllocationStateCapacity(state)
    ) {
      state.slots += 1;
      state.fraction -= 1;
    }

    if (Math.abs(state.fraction) <= SLOT_ALLOCATION_EPSILON) {
      state.fraction = 0;
    }

    if (!hasAllocationStateCapacity(state) && state.fraction > SLOT_ALLOCATION_EPSILON) {
      overflow = state.fraction;
      state.fraction = 0;
    }

    return overflow;
  }

  function reconcileSlotAllocationStates(states, targetTotalCap) {
    let remaining =
      targetTotalCap - states.reduce((sum, state) => sum + state.slots, 0);

    while (remaining > 0) {
      const nextState = states
        .filter(hasAllocationStateCapacity)
        .sort(compareAllocationStateReconciliationPriority)[0];

      if (!nextState) {
        break;
      }

      nextState.slots += 1;
      nextState.fraction = 0;
      remaining -= 1;
    }
  }

  function compareAllocationStateLowToHigh(left, right) {
    return compareTabSlotPriority(right, left);
  }

  function compareAllocationStateReconciliationPriority(left, right) {
    if (right.fraction !== left.fraction) {
      return right.fraction - left.fraction;
    }

    return compareTabSlotPriority(left, right);
  }

  function hasAllocationStateCapacity(state) {
    return state.slots < state.cap;
  }

  function findAllocationState(states, key) {
    return states.find((state) => state.key === key) ?? null;
  }

  function normalizeTabAllocationInputs(tabs) {
    return (Array.isArray(tabs) ? tabs : [])
      .map((tab, index) => {
        const tabId = Number(tab?.tabId);
        const score = Number(tab?.score);
        const cap = Number(tab?.cap);

        if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(cap) || cap <= 0) {
          return null;
        }

        const normalizedTabId = Number.isInteger(tabId) && tabId > 0 ? tabId : index + 1;

        return {
          key: String(normalizedTabId),
          tabId: normalizedTabId,
          score,
          cap: Math.trunc(cap),
          active: tab?.active === true,
          lastActiveAt: normalizeTimestampForPriority(tab?.lastActiveAt),
          order: Number.isFinite(Number(tab?.order)) ? Number(tab.order) : index,
        };
      })
      .filter(Boolean);
  }

  function normalizeTimestampForPriority(value) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  function compareTabSlotPriority(left, right) {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.active !== left.active) {
      return right.active ? 1 : -1;
    }

    if (right.lastActiveAt !== left.lastActiveAt) {
      return right.lastActiveAt - left.lastActiveAt;
    }

    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.tabId - right.tabId;
  }

  function buildTabSlotAllocation(tab, rawSlots, slots) {
    return {
      tabId: tab.tabId,
      score: tab.score,
      cap: tab.cap,
      rawSlots,
      slots,
    };
  }

  globalThis.ZeroLatencyPreloadSchedulerAllocation = {
    resolveAsymptoticPreloadCap,
    allocateTabPreloadSlots,
  };
})();
