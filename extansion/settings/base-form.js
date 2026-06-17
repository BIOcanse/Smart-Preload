(() => {
  const baseFormRead = globalThis.ZeroLatencySettingsBaseFormRead;
  const baseFormSync = globalThis.ZeroLatencySettingsBaseFormSync;
  const baseFormComputed = globalThis.ZeroLatencySettingsBaseFormComputed;

  function createBaseFormController({
    elements,
    stateElements,
    settingsApi,
    schedulerForm,
    getDraftSettings,
    getAiControls,
  }) {
    function readFormSettings() {
      return baseFormRead.readBaseFormSettings({
        elements,
        settingsApi,
        schedulerForm,
        draftSettings: getDraftSettings(),
        aiControls: getAiControls?.(),
      });
    }

    function syncBaseControlsFromSettings(settings) {
      baseFormSync.syncBaseControlsFromSettings({
        elements,
        settingsApi,
        schedulerForm,
        aiControls: getAiControls?.(),
        settings,
      });
    }

    function syncMutuallyExclusivePreloadModeControls(target) {
      baseFormSync.syncMutuallyExclusivePreloadModeControls({ elements, target });
    }

    function updateComputedState(settings) {
      baseFormComputed.updateBaseFormComputedState({
        elements,
        stateElements,
        settingsApi,
        settings,
      });
    }

    return {
      readFormSettings,
      syncBaseControlsFromSettings,
      syncMutuallyExclusivePreloadModeControls,
      updateComputedState,
    };
  }

  globalThis.ZeroLatencySettingsBaseForm = {
    create: createBaseFormController,
  };
})();
