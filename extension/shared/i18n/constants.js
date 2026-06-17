(() => {
  const DEFAULT_LANGUAGE = "en";
  const SETTINGS_STORAGE_KEY = "userSettingsV1";
  const LANGUAGE_MODE_VALUES = [
    "auto",
    "en",
    "zh_CN",
    "zh_TW",
    "ja",
    "ko",
    "de",
    "fr",
    "es",
    "pt_BR",
    "ru",
  ];
  const LANGUAGE_OPTIONS = [
    { value: "auto", labelKey: "languageAuto", fallback: "Automatic" },
    { value: "en", labelKey: "languageEnglish", fallback: "English" },
    { value: "zh_CN", labelKey: "languageChineseSimplified", fallback: "Simplified Chinese" },
    { value: "zh_TW", labelKey: "languageChineseTraditional", fallback: "Traditional Chinese" },
    { value: "ja", labelKey: "languageJapanese", fallback: "Japanese" },
    { value: "ko", labelKey: "languageKorean", fallback: "Korean" },
    { value: "de", labelKey: "languageGerman", fallback: "German" },
    { value: "fr", labelKey: "languageFrench", fallback: "French" },
    { value: "es", labelKey: "languageSpanish", fallback: "Spanish" },
    { value: "pt_BR", labelKey: "languagePortugueseBrazil", fallback: "Portuguese (Brazil)" },
    { value: "ru", labelKey: "languageRussian", fallback: "Russian" },
  ];

  globalThis.ZeroLatencyI18nConstants = {
    DEFAULT_LANGUAGE,
    SETTINGS_STORAGE_KEY,
    LANGUAGE_MODE_VALUES,
    LANGUAGE_OPTIONS,
    SUPPORTED_LOCALE_IDS: LANGUAGE_MODE_VALUES.filter((value) => value !== "auto"),
  };
})();
