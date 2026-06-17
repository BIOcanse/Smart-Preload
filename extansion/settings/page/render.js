(function () {
  function renderSettingsPageForm(context, settings) {
    context.baseForm.syncBaseControlsFromSettings(settings);
    context.ruleCardController.renderRuleCards(settings);
    context.baseForm.updateComputedState(settings);
    context.getAiControls()?.syncMismatchWarning?.();
    context.settingsNavigation?.queueSync?.();
  }

  globalThis.ZeroLatencySettingsPageRender = {
    renderSettingsPageForm,
  };
})();
