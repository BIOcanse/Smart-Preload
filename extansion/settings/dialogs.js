(() => {
  const { createStandardDialog } = globalThis.ZeroLatencySettingsDialogModal;
  const { createRealPreloadRiskGuard } = globalThis.ZeroLatencySettingsRealPreloadRiskDialog;

  function create({ translate, settingsApi } = {}) {
    const standardDialog = createStandardDialog({ translate });
    const realPreloadRisk = createRealPreloadRiskGuard({
      dialog: standardDialog,
      translate,
      settingsApi,
    });

    return {
      confirm: standardDialog.confirm,
      close: standardDialog.close,
      confirmRealPreloadEnableIfNeeded:
        realPreloadRisk.confirmIfNeeded,
      resetRealPreloadRiskAcceptance:
        realPreloadRisk.resetAcceptance,
      requiresRealPreloadRiskConfirmation:
        realPreloadRisk.requiresConfirmation,
    };
  }

  globalThis.ZeroLatencySettingsDialogs = {
    create,
  };
})();
