(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  let warningElement = null;
  let translate = defaultTranslate;
  let isRealPreloadEnabled = () => false;
  let refreshTimerId = null;

  function initialize(options = {}) {
    warningElement = document.getElementById("settings-performance-warning");
    translate =
      typeof options.translate === "function" ? options.translate : defaultTranslate;
    isRealPreloadEnabled =
      typeof options.isRealPreloadEnabled === "function"
        ? options.isRealPreloadEnabled
        : () => false;

    ensureRefresh();
    void refresh();
  }

  function ensureRefresh() {
    if (refreshTimerId !== null) {
      return;
    }

    refreshTimerId = window.setInterval(() => {
      void refresh();
    }, 10000);
  }

  async function refresh() {
    if (!warningElement) {
      return;
    }

    try {
      const snapshot = await chrome.runtime.sendMessage({
        type: "visit-graph:get-debug-snapshot",
        mode: "performance-warning",
      });
      render(selectRuntimeWarningToDisplay(snapshot));
    } catch (error) {
      console.error(error);
      render(null);
    }
  }

  function selectRuntimeWarningToDisplay(snapshot) {
    if (
      isRealPreloadEnabled() === true &&
      snapshot?.nativeAppModeWarning?.active === true
    ) {
      return snapshot.nativeAppModeWarning;
    }

    if (snapshot?.performanceWarning?.active === true) {
      return snapshot.performanceWarning;
    }

    return snapshot?.realPreloadRecommendationWarning;
  }

  function render(performanceWarning) {
    if (!warningElement) {
      return;
    }

    if (performanceWarning?.active !== true) {
      warningElement.classList.add("is-hidden");
      return;
    }

    warningElement.textContent = translate(
      performanceWarning.messageKey || "performanceInsufficientReducePreloadCaps",
      [],
      performanceWarning.messageFallback ||
        "Performance pressure detected. Lower the preload limits."
    );
    warningElement.classList.remove("is-hidden");
  }

  globalThis.ZeroLatencySettingsPerformanceWarning = {
    initialize,
    refresh,
    selectRuntimeWarningToDisplay,
  };
})();
