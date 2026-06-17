(function () {
  function createStatusBarController({
    elements,
    getSavedSettings,
    getDraftSettings,
    translate,
  }) {
    const t =
      typeof translate === "function" ? translate : (key, substitutions, fallback) => fallback || key;

    function isDirty() {
      return JSON.stringify(getSavedSettings()) !== JSON.stringify(getDraftSettings());
    }

    function setDirtyStatus(message) {
      elements.footerStatusTitle.textContent = t("commonUnsaved", [], "Unsaved");
      elements.footerStatusText.textContent = message;
      elements.navStatusText.textContent = t("commonUnsaved", [], "Unsaved");
      syncActionButtons();
    }

    function setStatus(title, text) {
      elements.footerStatusTitle.textContent = title;
      elements.footerStatusText.textContent = text;
      elements.navStatusText.textContent = text;
      syncActionButtons();
    }

    function syncActionButtons() {
      const dirty = isDirty();
      elements.saveButton.disabled = !dirty;
      elements.resetButton.disabled = !dirty;
    }

    return {
      isDirty,
      setDirtyStatus,
      setStatus,
      syncActionButtons,
    };
  }

  globalThis.ZeroLatencySettingsStatusBar = {
    create: createStatusBarController,
  };
})();
