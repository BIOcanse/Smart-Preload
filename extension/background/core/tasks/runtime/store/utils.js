(function () {
  function normalizeTaskStoreText(value) {
    return String(value || "").trim();
  }

  globalThis.ZeroLatencyBackgroundTaskStoreUtils = {
    normalizeTaskStoreText,
  };
})();
