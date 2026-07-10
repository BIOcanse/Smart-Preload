(() => {
  function createRealPreloadRiskGuard({ dialog, translate, settingsApi } = {}) {
    const t =
      typeof translate === "function"
        ? translate
        : (key, substitutions = [], fallback = "") => fallback || key;
    let acceptedForCurrentEnable = false;
    let advancedAcknowledgedForCurrentEnable = false;
    let pendingConfirmation = null;

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
        if (
          acceptedForCurrentEnable &&
          advancedAcknowledgedForCurrentEnable &&
          isRealPreloadEnabled(draftSettings)
        ) {
          markAdvancedAcknowledgement(draftSettings);
        }
        return true;
      }

      if (!pendingConfirmation) {
        pendingConfirmation = runConfirmation(savedSettings, draftSettings).finally(() => {
          pendingConfirmation = null;
        });
      }

      const confirmed = await pendingConfirmation;

      if (confirmed && advancedAcknowledgedForCurrentEnable) {
        markAdvancedAcknowledgement(draftSettings);
      }

      return confirmed;
    }

    async function runConfirmation(savedSettings, draftSettings) {
      const riskConfirmed = await dialog.confirm({
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

      if (!riskConfirmed) {
        return false;
      }

      if (!hasAdvancedAcknowledgement(savedSettings, draftSettings)) {
        const typedConfirmed = await dialog.confirmText({
          variant: "warning",
          title: t(
            "settingsRealPreloadTypedConfirmTitle",
            [],
            "Type the confirmation sentence"
          ),
          message: t(
            "settingsRealPreloadTypedConfirmBody",
            [],
            "To prevent accidental enablement, copy the sentence below into the input field."
          ),
          inputInstruction: t(
            "settingsRealPreloadTypedConfirmInstruction",
            [],
            "The text must match the displayed sentence before Real Preload can be enabled for the first time."
          ),
          expectedText: t(
            "settingsRealPreloadTypedConfirmSentence",
            [],
            "I understand that Real Preload opens real background pages. I will enable it and accept the risks."
          ),
          inputLabel: t(
            "settingsRealPreloadTypedConfirmInputLabel",
            [],
            "Confirmation sentence"
          ),
          inputErrorText: t(
            "settingsRealPreloadTypedConfirmMismatch",
            [],
            "The confirmation sentence does not match."
          ),
          cancelLabel: t("settingsRealPreloadRiskCancel", [], "Keep it off"),
          confirmLabel: t(
            "settingsRealPreloadTypedConfirmContinue",
            [],
            "Continue"
          ),
          confirmClassName: "danger-button",
        });

        if (!typedConfirmed) {
          return false;
        }

        const disclaimerAccepted = await dialog.confirm({
          variant: "warning",
          title: t(
            "settingsRealPreloadDisclaimerTitle",
            [],
            "Real Preload disclaimer"
          ),
          message: t(
            "settingsRealPreloadDisclaimerBody",
            [],
            "Real Preload is an advanced local feature. Safety guards reduce known risks, but they cannot guarantee that every site will remain side-effect free."
          ),
          items: [
            t(
              "settingsRealPreloadDisclaimerItemPages",
              [],
              "Hidden real background pages may still affect sessions, counters, server state, downloads, or site-specific workflows."
            ),
            t(
              "settingsRealPreloadDisclaimerItemSensitive",
              [],
              "Turn it off or pause preloading for online exams, banking, trading, admin panels, unsafe sites, and other sensitive workflows."
            ),
            t(
              "settingsRealPreloadDisclaimerItemResponsibility",
              [],
              "You are responsible for deciding where to use this feature and for keeping preload limits appropriate for your device."
            ),
          ],
          cancelLabel: t("settingsRealPreloadRiskCancel", [], "Keep it off"),
          confirmLabel: t("settingsRealPreloadDisclaimerAgree", [], "I agree"),
          confirmClassName: "danger-button",
          initialFocus: "cancel",
        });

        if (!disclaimerAccepted) {
          return false;
        }

        markAdvancedAcknowledgement(draftSettings);
        advancedAcknowledgedForCurrentEnable = true;
      } else if (hasAdvancedAcknowledgement(savedSettings, draftSettings)) {
        advancedAcknowledgedForCurrentEnable = true;
      }

      acceptedForCurrentEnable = true;
      return true;
    }

    function resetAcceptance() {
      acceptedForCurrentEnable = false;
      advancedAcknowledgedForCurrentEnable = false;
    }

    function hasAdvancedAcknowledgement(savedSettings, draftSettings) {
      return (
        savedSettings?.preloading?.realPreloadRiskAcknowledged === true ||
        draftSettings?.preloading?.realPreloadRiskAcknowledged === true
      );
    }

    function markAdvancedAcknowledgement(draftSettings) {
      if (!draftSettings || typeof draftSettings !== "object") {
        return;
      }
      if (!draftSettings.preloading || typeof draftSettings.preloading !== "object") {
        draftSettings.preloading = {};
      }
      draftSettings.preloading.realPreloadRiskAcknowledged = true;
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
