(function () {
  function createSettingsPageContext() {
    const settingsApi = globalThis.ZeroLatencySettings;
    const settingsAiModels = globalThis.ZeroLatencySettingsAiModels;
    const settingsAiModelControls = globalThis.ZeroLatencySettingsAiModelControls;
    const settingsAppUpdates = globalThis.ZeroLatencySettingsAppUpdates;
    const settingsUi = globalThis.ZeroLatencySettingsUi;
    const settingsRuleCards = globalThis.ZeroLatencySettingsRuleCards;
    const settingsRuleCardController = globalThis.ZeroLatencySettingsRuleCardController;
    const settingsHistoryDeletion = globalThis.ZeroLatencySettingsHistoryDeletion;
    const settingsHistoryTransfer = globalThis.ZeroLatencySettingsHistoryTransfer;
    const settingsPerformanceWarning = globalThis.ZeroLatencySettingsPerformanceWarning;
    const settingsPlatformAdaptation = globalThis.ZeroLatencySettingsPlatformAdaptation;
    const settingsNavigation = globalThis.ZeroLatencySettingsNavigation;
    const settingsDialogs = globalThis.ZeroLatencySettingsDialogs;
    const settingsSchedulerForm = globalThis.ZeroLatencySettingsSchedulerForm;
    const settingsStatusBar = globalThis.ZeroLatencySettingsStatusBar;
    const settingsBaseForm = globalThis.ZeroLatencySettingsBaseForm;
    const settingsLanguageControls = globalThis.ZeroLatencySettingsLanguageControls;
    const settingsElements = globalThis.ZeroLatencySettingsElements;
    const i18n = globalThis.ZeroLatencyI18n;
    const t = (key, substitutions = [], fallback = "") =>
      i18n?.t?.(key, substitutions, fallback) || fallback || key;

    const pageElements = settingsElements.collect();
    const formElements = pageElements.form;
    let savedSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
    let draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
    let aiControls = null;

    const schedulerForm = settingsSchedulerForm.create({
      elements: formElements,
      settingsApi,
    });
    const statusBar = settingsStatusBar.create({
      elements: pageElements.statusBar,
      getSavedSettings: () => savedSettings,
      getDraftSettings: () => draftSettings,
      translate: t,
    });
    const baseForm = settingsBaseForm.create({
      elements: formElements,
      stateElements: pageElements.baseFormState,
      settingsApi,
      schedulerForm,
      getDraftSettings: () => draftSettings,
      getAiControls: () => aiControls,
    });
    const languageControls = settingsLanguageControls.create({
      elements: formElements,
      i18n,
      settingsApi,
      settingsUi,
      translate: t,
      getAiControls: () => aiControls,
    });
    const ruleCardController = settingsRuleCardController.create({
      containers: pageElements.ruleCardContainers,
      preloadCardIds:
        settingsApi.PRELOAD_RULE_CARD_IDS ?? [
          "nativePerPagePreloadLimit",
          "highWeightRank",
          "perPagePreloadLimit",
          "highWeightRankTab",
          "googleBookmarkRank",
        ],
      trackingCardIds: settingsApi.TRACKING_RULE_CARD_IDS ?? [],
      ruleCardSchema: settingsApi.RULE_CARD_SCHEMA ?? {},
      settingsApi,
      renderer: settingsRuleCards,
      statusBar,
      translate: t,
      getDraftSettings: () => draftSettings,
      setDraftSettings: (nextSettings) => {
        draftSettings = nextSettings;
      },
    });
    const dialogs = settingsDialogs.create({
      translate: t,
      settingsApi,
    });

    const context = {
      settingsApi,
      settingsAiModels,
      settingsAiModelControls,
      settingsAppUpdates,
      settingsHistoryDeletion,
      settingsHistoryTransfer,
      settingsPerformanceWarning,
      settingsPlatformAdaptation,
      settingsNavigation,
      dialogs,
      i18n,
      t,
      pageElements,
      formElements,
      saveButton: pageElements.saveButton,
      resetButton: pageElements.resetButton,
      schedulerForm,
      statusBar,
      baseForm,
      languageControls,
      ruleCardController,
      getSavedSettings: () => savedSettings,
      setSavedSettings: (nextSettings) => {
        savedSettings = nextSettings;
      },
      getDraftSettings: () => draftSettings,
      setDraftSettings: (nextSettings) => {
        draftSettings = nextSettings;
      },
      getAiControls: () => aiControls,
    };

    aiControls = settingsAiModelControls?.create?.({
      elements: formElements,
      warningElement: pageElements.aiPredictionMismatchWarning,
      settingsApi,
      modelLoader: settingsAiModels,
      translate: t,
      readFormSettings: () => baseForm.readFormSettings(),
      setDraftSettings: (nextSettings) => {
        draftSettings = nextSettings;
      },
      updateComputedState: (nextSettings) => baseForm.updateComputedState(nextSettings),
    });

    return context;
  }

  globalThis.ZeroLatencySettingsPageContext = {
    createSettingsPageContext,
  };
})();
