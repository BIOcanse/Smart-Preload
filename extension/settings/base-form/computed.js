(() => {
  function updateBaseFormComputedState({
    elements,
    stateElements,
    settingsApi,
    settings,
  }) {
    const effectiveSettings = settingsApi.resolveEffectiveSettings(settings);
    const realPreloadEnabled =
      settingsApi.isRealPreloadEnabled?.(effectiveSettings) === true;

    stateElements.watchdogIntervalRow.classList.toggle(
      "is-disabled",
      !effectiveSettings.preloadWindow.watchdogEnabled || !realPreloadEnabled
    );
    stateElements.watchdogIntervalRow.classList.toggle(
      "has-disabled-select",
      !realPreloadEnabled
    );
    elements.watchdogIntervalSeconds.disabled =
      !effectiveSettings.preloadWindow.watchdogEnabled || !realPreloadEnabled;
    stateElements.transitionWindowScopeRow.classList.toggle(
      "has-disabled-select",
      !effectiveSettings.preloading.transitionWindowScope.enabled
    );
    elements.transitionWindowScope.disabled =
      !effectiveSettings.preloading.transitionWindowScope.enabled;
    stateElements.crossSiteCurrentTabSwapRow?.classList.toggle(
      "is-disabled",
      !realPreloadEnabled
    );
    elements.crossSiteCurrentTabSwap.disabled = !realPreloadEnabled;
    stateElements.hiddenTabsSchedulerGroup?.classList.toggle(
      "is-disabled",
      !realPreloadEnabled
    );
    for (const element of [
      elements.schedulerTabTotalMin,
      elements.schedulerTabTotalMax,
      elements.schedulerTabHalfLifeTabs,
      elements.watchdogEnabled,
      elements.fullscreenPressurePolicy,
      elements.forceMinimize,
    ]) {
      if (element) {
        element.disabled = !realPreloadEnabled;
      }
    }
  }

  globalThis.ZeroLatencySettingsBaseFormComputed = {
    updateBaseFormComputedState,
  };
})();
