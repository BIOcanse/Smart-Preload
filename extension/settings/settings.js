(function () {
  const { createSettingsPageContext } = globalThis.ZeroLatencySettingsPageContext;
  const { initializeSettingsPage } = globalThis.ZeroLatencySettingsPageActions;

  const context = createSettingsPageContext();
  void initializeSettingsPage(context);
})();
