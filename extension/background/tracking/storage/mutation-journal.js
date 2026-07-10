(function () {
  const appliedEventsByState = new WeakMap();

  function recordAppliedEvent(state, event) {
    if (!state || typeof state !== "object" || !event || typeof event !== "object") {
      return;
    }

    const events = appliedEventsByState.get(state) || [];
    events.push(structuredCloneValue(event));
    appliedEventsByState.set(state, events);
  }

  function drainAppliedEvents(state) {
    const events = appliedEventsByState.get(state) || [];
    appliedEventsByState.delete(state);
    return events;
  }

  function structuredCloneValue(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }

  globalThis.ZeroLatencyTrackingMutationJournal = {
    recordAppliedEvent,
    drainAppliedEvents,
  };
})();
