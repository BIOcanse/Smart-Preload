(() => {
  function createLanguageControls({
    elements,
    i18n,
    settingsApi,
    settingsUi,
    translate,
    getAiControls,
  }) {
    function refreshLocalizedUiText() {
      settingsApi.refreshLocalizedText?.();
      i18n?.applyDocument?.(document);
      settingsUi.compactInlineSettingDescriptions(document, { translate });
    }

    function populateLanguageOptions() {
      const options = Array.isArray(i18n?.LANGUAGE_OPTIONS) ? i18n.LANGUAGE_OPTIONS : [];

      elements.languageMode.textContent = "";

      for (const optionSpec of options) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = translate(optionSpec.labelKey, [], optionSpec.fallback);
        elements.languageMode.append(option);
      }
    }

    function populateTransitionWindowOptions() {
      const options = Array.isArray(settingsApi.TRANSITION_WINDOW_OPTIONS)
        ? settingsApi.TRANSITION_WINDOW_OPTIONS
        : [];

      elements.transitionWindowScope.textContent = "";

      for (const optionSpec of options) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = optionSpec.label;
        elements.transitionWindowScope.append(option);
      }
    }

    async function applyLanguageModeToPage(languageMode) {
      const normalizedLanguageMode =
        settingsApi.normalizeLanguageMode?.(languageMode) ||
        i18n?.normalizeLanguageMode?.(languageMode) ||
        "auto";
      await i18n?.setLanguageMode?.(normalizedLanguageMode);
      refreshLocalizedUiText();
      populateLanguageOptions();
      populateTransitionWindowOptions();
      getAiControls?.()?.populateProviderOptions?.();
    }

    return {
      refreshLocalizedUiText,
      populateLanguageOptions,
      populateTransitionWindowOptions,
      applyLanguageModeToPage,
    };
  }

  globalThis.ZeroLatencySettingsLanguageControls = {
    create: createLanguageControls,
  };
})();
