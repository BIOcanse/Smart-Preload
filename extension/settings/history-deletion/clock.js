(() => {
  let utcClockTimerId = null;

  function startUtcClock(element) {
    if (!element || utcClockTimerId !== null) {
      return;
    }

    updateUtcClock(element);
    utcClockTimerId = window.setInterval(() => {
      updateUtcClock(element);
    }, 1000);
  }

  function updateUtcClock(element) {
    if (!element) {
      return;
    }

    element.textContent = new Date()
      .toISOString()
      .replace("T", " ")
      .replace("Z", " UTC");
  }

  globalThis.ZeroLatencySettingsHistoryDeletionClock = {
    startUtcClock,
    updateUtcClock,
  };
})();
