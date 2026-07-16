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
    context.settingsHistoryTransfer?.initialize?.({
      dialogs: context.dialogs,
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
      if (context.settingsPlatformAdaptation?.isMobilePlatform !== true) {
        context.settingsAppUpdates?.initialize?.({ setStatus: context.statusBar.setStatus });
        context.settingsPerformanceWarning?.initialize?.({
          translate: context.t,
          isRealPreloadEnabled: () => context.formElements.realPreloadEnabled.checked === true,
        });
      }
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
    context.dialogs.resetRealPreloadRiskAcceptance();
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

    context.ruleCardController.flushPendingChanges?.();
    context.baseForm.syncMutuallyExclusivePreloadModeControls(event?.target);

    if (event?.target === formElements.aiPredictionProvider) {
      aiControls?.syncProviderFieldsFromSettings?.(context.getDraftSettings());
    }

    context.setDraftSettings(context.baseForm.readFormSettings());
    let draftSettings = context.getDraftSettings();

    if (await shouldCancelRealPreloadEnable(context, event?.target, draftSettings)) {
      revertRealPreloadEnable(context);
      return;
    }

    context.setDraftSettings(context.baseForm.readFormSettings());
    draftSettings = context.getDraftSettings();

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
      event?.target === formElements.aiModelListMode ||
      event?.target === formElements.aiProviderApiKey ||
      event?.target === formElements.aiProviderEndpoint
    ) {
      void aiControls?.refreshOptionsForCurrentProvider?.();
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
    if (
      !(await context.dialogs.confirmRealPreloadEnableIfNeeded(
        context.getSavedSettings(),
        context.getDraftSettings()
      ))
    ) {
      revertRealPreloadEnable(context);
      return;
    }

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

  async function shouldCancelRealPreloadEnable(context, target, draftSettings) {
    const { formElements } = context;

    if (context.settingsApi.isRealPreloadEnabled?.(draftSettings) !== true) {
      context.dialogs.resetRealPreloadRiskAcceptance();
      return false;
    }

    if (
      target !== formElements.realPreloadEnabled &&
      target !== formElements.crossSiteCurrentTabSwap
    ) {
      return false;
    }

    const confirmed = await context.dialogs.confirmRealPreloadEnableIfNeeded(
      context.getSavedSettings(),
      draftSettings
    );
    return !confirmed;
  }

  function revertRealPreloadEnable(context) {
    const { formElements } = context;
    formElements.realPreloadEnabled.checked = false;
    formElements.crossSiteCurrentTabSwap.checked = false;
    context.dialogs.resetRealPreloadRiskAcceptance();
    context.setDraftSettings(context.baseForm.readFormSettings());
    const draftSettings = context.getDraftSettings();
    renderSettingsPageForm(context, draftSettings);
    context.baseForm.updateComputedState(draftSettings);
    context.settingsNavigation?.queueSync?.();

    if (context.statusBar.isDirty()) {
      context.statusBar.setDirtyStatus(
        context.t("settingsRealPreloadRiskRejected", [], "Real Preload remains off.")
      );
    } else {
      context.statusBar.setStatus(
        context.t("commonReady", [], "Ready"),
        context.t("settingsNoUnsavedChanges", [], "No unsaved changes.")
      );
    }
  }

  globalThis.ZeroLatencySettingsPageActions = {
    initializeSettingsPage,
    createSettingsPageActions,
  };
})();
