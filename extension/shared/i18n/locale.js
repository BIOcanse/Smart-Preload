(() => {
  const constants = globalThis.ZeroLatencyI18nConstants;

  function getUiLanguage() {
    try {
      return (
        globalThis.chrome?.i18n?.getUILanguage?.() ||
        globalThis.navigator?.language ||
        constants.DEFAULT_LANGUAGE
      );
    } catch (_error) {
      return constants.DEFAULT_LANGUAGE;
    }
  }

  function normalizeLanguageMode(value) {
    return constants.LANGUAGE_MODE_VALUES.includes(value) ? value : "auto";
  }

  function resolveLocaleId(languageMode = "auto") {
    const normalizedMode = normalizeLanguageMode(languageMode);
    return normalizedMode === "auto" ? normalizeLocaleId(getUiLanguage()) : normalizedMode;
  }

  function normalizeLocaleId(language) {
    const normalized = String(language || "")
      .replace("_", "-")
      .toLowerCase();

    if (
      normalized.startsWith("zh-tw") ||
      normalized.startsWith("zh-hk") ||
      normalized.startsWith("zh-mo")
    ) {
      return "zh_TW";
    }
    if (normalized.startsWith("zh")) {
      return "zh_CN";
    }
    if (normalized.startsWith("pt-br")) {
      return "pt_BR";
    }

    const primaryLanguage = normalized.split("-")[0];
    return constants.SUPPORTED_LOCALE_IDS.includes(primaryLanguage)
      ? primaryLanguage
      : constants.DEFAULT_LANGUAGE;
  }

  function normalizeHtmlLanguage(language) {
    return localeIdToHtmlLanguage(normalizeLocaleId(language));
  }

  function localeIdToHtmlLanguage(localeId) {
    if (localeId === "zh_CN") {
      return "zh-CN";
    }
    if (localeId === "zh_TW") {
      return "zh-TW";
    }
    if (localeId === "pt_BR") {
      return "pt-BR";
    }
    return constants.SUPPORTED_LOCALE_IDS.includes(localeId)
      ? localeId
      : constants.DEFAULT_LANGUAGE;
  }

  globalThis.ZeroLatencyI18nLocale = {
    getUiLanguage,
    normalizeLanguageMode,
    resolveLocaleId,
    normalizeLocaleId,
    normalizeHtmlLanguage,
    localeIdToHtmlLanguage,
  };
})();
