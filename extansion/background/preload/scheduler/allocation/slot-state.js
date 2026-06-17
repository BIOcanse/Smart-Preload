(function () {
  const { SLOT_ALLOCATION_EPSILON } =
    globalThis.ZeroLatencyPreloadSchedulerAllocationConstants;
  const { compareTabSlotPriority } =
    globalThis.ZeroLatencyPreloadSchedulerSlotInput;

  function buildInitialSlotAllocationStates(tabs, targetTotalCap) {
    const scoreSum = tabs.reduce((sum, tab) => sum + tab.score, 0);

    return tabs.map((tab) => {
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
  }

  function redistributeSlotFractionsFromLowToHigh(allocationStates) {
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

  globalThis.ZeroLatencyPreloadSchedulerSlotState = {
    buildInitialSlotAllocationStates,
    redistributeSlotFractionsFromLowToHigh,
    reconcileSlotAllocationStates,
    findAllocationState,
  };
})();
