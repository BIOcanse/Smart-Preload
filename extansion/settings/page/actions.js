(function () {
  const { renderSettingsPageForm } = globalThis.ZeroLatencySettingsPageRender;
  const { bindSettingsPageEvents } = globalThis.ZeroLatencySettingsPageEvents;

  async function initializeSettingsPage(context) {
    await context.i18n?.initialize?.();
    context.languageControls.refreshLocalizedUiText();
    context.languageControls.populateTransitionWindowOptions();
    context.languageControls.populateLanguageOptions();
    context.getAiControls()?.populateProviderOptions?.();
    bindSettingsPageEvents(context, createSettingsPageActions(context));
    context.settingsHistoryDeletion?.initialize?.({
      setStatus: context.statusBar.setStatus,
      translate: context.t,
    });
    context.settingsNavigation?.initialize?.();
    context.statusBar.setStatus(
      context.t("commonLoading", [], "Loading"),
      context.t("settingsReadingLocalSettings", [], "Reading local extension settings.")
    );

    try {
      const savedSettings = await context.settingsApi.loadSettings(chrome.storage.local);
      context.setSavedSettings(savedSettings);
      context.setDraftSettings(context.settingsApi.cloneSettings(savedSettings));
      renderSettingsPageForm(context, context.getDraftSettings());
      context.settingsNavigation?.queueSync?.();
      context.settingsAppUpdates?.initialize?.({ setStatus: context.statusBar.setStatus });
      context.settingsPerformanceWarning?.initialize?.({
        translate: context.t,
        isRealPreloadEnabled: () => context.formElements.realPreloadEnabled.checked === true,
      });
      context.statusBar.setStatus(
        context.t("commonReady", [], "Ready"),
        context.t("settingsNoUnsavedChanges", [], "No unsaved changes.")
      );
    } catch (error) {
      console.error(error);
      context.statusBar.setStatus(
        context.t("commonFailed", [], "Failed"),
        context.t("settingsCouldNotLoad", [], "Could not load settings from storage.")
      );
    }
  }

  function createSettingsPageActions(context) {
    return {
      handleFormChange: (event) => handleFormChange(context, event),
      resetDraftSettings: () => resetDraftSettings(context),
      saveCurrentSettings: () => saveCurrentSettings(context),
    };
  }

  async function resetDraftSettings(context) {
    context.setDraftSettings(context.settingsApi.cloneSettings(context.settingsApi.DEFAULT_SETTINGS));
    await context.languageControls.applyLanguageModeToPage(
      context.getDraftSettings().appearance.languageMode
    );
    renderSettingsPageForm(context, context.getDraftSettings());

    if (context.statusBar.isDirty()) {
      context.statusBar.setDirtyStatus(
        context.t("settingsDefaultsRestored", [], "Defaults restored in the form. Save to apply.")
      );
    } else {
      context.statusBar.setStatus(
        context.t("commonReady", [], "Ready"),
        context.t("settingsNoUnsavedChanges", [], "No unsaved changes.")
      );
    }
  }

  async function handleFormChange(context, event) {
    const { formElements } = context;
    const aiControls = context.getAiControls();

    context.baseForm.syncMutuallyExclusivePreloadModeControls(event?.target);

    if (event?.target === formElements.aiPredictionProvider) {
      aiControls?.syncProviderFieldsFromSettings?.(context.getDraftSettings());
    }

    context.setDraftSettings(context.baseForm.readFormSettings());
    const draftSettings = context.getDraftSettings();

    if (event?.target === formElements.languageMode) {
      await context.languageControls.applyLanguageModeToPage(
        draftSettings.appearance.languageMode
      );
      renderSettingsPageForm(context, draftSettings);
    }

    if (context.schedulerForm.isSchedulerFormElement(event?.target)) {
      context.schedulerForm.syncSchedulerFieldsFromSettings(draftSettings);
    }
    if (
      event?.target === formElements.aiPredictionProvider ||
      event?.target === formElements.aiProviderApiKey ||
      event?.target === formElements.aiProviderEndpoint
    ) {
      void aiControls?.refreshOptionsForCurrentProvider?.();
    }
    if (
      event?.target === formElements.aiPredictionModel ||
      event?.target === formElements.aiPredictionEnabled
    ) {
      void aiControls?.ensureSelectedLmStudioModelLoaded?.(draftSettings);
    }
    if (event?.target !== formElements.languageMode) {
      context.ruleCardController.renderRuleCards(draftSettings);
    }
    context.baseForm.updateComputedState(draftSettings);
    aiControls?.syncMismatchWarning?.();
    context.settingsNavigation?.queueSync?.();

    if (context.statusBar.isDirty()) {
      context.statusBar.setDirtyStatus(
        context.t("settingsUnsavedReady", [], "Unsaved changes are ready to be applied.")
      );
    } else {
      context.statusBar.setStatus(
        context.t("commonReady", [], "Ready"),
        context.t("settingsNoUnsavedChanges", [], "No unsaved changes.")
      );
    }
  }

  async function saveCurrentSettings(context) {
    context.setDraftSettings(context.baseForm.readFormSettings());
    context.statusBar.setStatus(
      context.t("commonSaving", [], "Saving"),
      context.t("settingsWritingLocalSettings", [], "Writing settings to local extension storage.")
    );

    try {
      const storedSettings = await context.settingsApi.saveSettings(
        chrome.storage.local,
        context.getDraftSettings()
      );
      context.setSavedSettings(storedSettings);
      context.setDraftSettings(context.settingsApi.cloneSettings(storedSettings));
      renderSettingsPageForm(context, context.getDraftSettings());
      void context.getAiControls()?.ensureSelectedLmStudioModelLoaded?.(context.getDraftSettings());
      context.statusBar.setStatus(
        context.t("commonSaved", [], "Saved"),
        context.t("settingsWrittenSuccessfully", [], "Settings written successfully.")
      );
    } catch (error) {
      console.error(error);
      context.statusBar.setStatus(
        context.t("commonFailed", [], "Failed"),
        context.t("settingsCouldNotSave", [], "Could not save settings.")
      );
    }
  }

  globalThis.ZeroLatencySettingsPageActions = {
    initializeSettingsPage,
    createSettingsPageActions,
  };
})();
