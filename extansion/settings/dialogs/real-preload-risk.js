(() => {
  function createRealPreloadRiskGuard({ dialog, translate, settingsApi } = {}) {
    const t =
      typeof translate === "function"
        ? translate
        : (key, substitutions = [], fallback = "") => fallback || key;
    let acceptedForCurrentEnable = false;

    function isRealPreloadEnabled(settings) {
      if (typeof settingsApi?.isRealPreloadEnabled === "function") {
        return settingsApi.isRealPreloadEnabled(settings) === true;
      }
      return settings?.preloading?.realPreloadEnabled === true;
    }

    function requiresConfirmation(savedSettings, draftSettings) {
      return (
        acceptedForCurrentEnable !== true &&
        isRealPreloadEnabled(savedSettings) !== true &&
        isRealPreloadEnabled(draftSettings) === true
      );
    }

    async function confirmIfNeeded(savedSettings, draftSettings) {
      if (!requiresConfirmation(savedSettings, draftSettings)) {
        return true;
      }

      const confirmed = await dialog.confirm({
        variant: "warning",
        title: t(
          "settingsRealPreloadRiskDialogTitle",
          [],
          "Real Preload can still be risky"
        ),
        message: t(
          "settingsRealPreloadRiskDialogBody",
          [],
          "Even with multiple safety protections, Real Preload still opens real background pages and may trigger unexpected behavior on some sites."
        ),
        detail: t(
          "settingsRealPreloadRiskDialogAdvice",
          [],
          "Turn it off or pause preloading for online exams, banking, trading, admin panels, unsafe sites, and other sensitive workflows."
        ),
        cancelLabel: t("settingsRealPreloadRiskCancel", [], "Keep it off"),
        confirmLabel: t("settingsRealPreloadRiskConfirm", [], "Enable anyway"),
        confirmClassName: "danger-button",
        initialFocus: "cancel",
      });

      if (confirmed) {
        acceptedForCurrentEnable = true;
      }
      return confirmed;
    }

    function resetAcceptance() {
      acceptedForCurrentEnable = false;
    }

    return {
      requiresConfirmation,
      confirmIfNeeded,
      resetAcceptance,
    };
  }

  globalThis.ZeroLatencySettingsRealPreloadRiskDialog = {
    createRealPreloadRiskGuard,
  };
})();
