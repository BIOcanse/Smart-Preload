(function () {
  function createPopupWarnings({ element, translate, requestSnapshot }) {
    let refreshInFlight = false;

    function render(performanceWarning) {
      if (!element) {
        return;
      }

      if (performanceWarning?.active !== true) {
        element.classList.add("hidden");
        return;
      }

      element.textContent = translate(
        performanceWarning.messageKey || "performanceInsufficientReducePreloadCaps",
        [],
        performanceWarning.messageFallback ||
          "Performance pressure detected. Lower the preload limits."
      );
      element.classList.remove("hidden");
    }

    function selectRuntimeWarningToDisplay(snapshot) {
      if (snapshot?.nativeAppModeWarning?.active === true) {
        return snapshot.nativeAppModeWarning;
      }

      if (snapshot?.performanceWarning?.active === true) {
        return snapshot.performanceWarning;
      }

      return snapshot?.realPreloadRecommendationWarning;
    }

    function refreshIfNeeded(
      performanceWarning,
      nativeAppModeWarning,
      realPreloadRecommendationWarning
    ) {
      if (
        !shouldRefreshRuntimeWarnings(
          performanceWarning,
          nativeAppModeWarning,
          realPreloadRecommendationWarning
        ) ||
        refreshInFlight
      ) {
        return;
      }

      refreshInFlight = true;
      requestSnapshot()
        .then((snapshot) => {
          render(selectRuntimeWarningToDisplay(snapshot));
        })
        .catch((error) => {
          console.error(error);
        })
        .finally(() => {
          refreshInFlight = false;
        });
    }

    return {
      render,
      selectRuntimeWarningToDisplay,
      refreshIfNeeded,
    };
  }

  function shouldRefreshRuntimeWarnings(
    performanceWarning,
    nativeAppModeWarning,
    realPreloadRecommendationWarning
  ) {
    return (
      performanceWarning?.reason === "cache-unavailable" ||
      nativeAppModeWarning?.reason === "native-app-warning-cache-unavailable" ||
      realPreloadRecommendationWarning?.reason === "real-preload-memory-unavailable"
    );
  }

  globalThis.ZeroLatencyPopupWarnings = {
    create: createPopupWarnings,
    shouldRefreshRuntimeWarnings,
  };
})();
