(function () {
  function bindSettingsPageEvents(context, actions) {
    for (const element of Object.values(context.formElements)) {
      if (!element) {
        continue;
      }

      element.addEventListener("change", actions.handleFormChange);
      element.addEventListener("input", actions.handleFormChange);
    }

    context.ruleCardController.bind();

    context.saveButton.addEventListener("click", () => {
      void actions.saveCurrentSettings();
    });

    context.resetButton.addEventListener("click", () => {
      void actions.resetDraftSettings();
    });
  }

  globalThis.ZeroLatencySettingsPageEvents = {
    bindSettingsPageEvents,
  };
})();
