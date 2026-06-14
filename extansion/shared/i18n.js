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
  const SUPPORTED_LOCALE_IDS = LANGUAGE_MODE_VALUES.filter((value) => value !== "auto");

  const messageBundleCache = new Map();
  let currentLanguageMode = "auto";
  let currentLocaleId = DEFAULT_LANGUAGE;
  let currentMessages = null;
  let initializePromise = null;

  function getChromeMessage(key) {
    if (!key || typeof key !== "string") {
      return "";
    }

    try {
      return globalThis.chrome?.i18n?.getMessage?.(key) || "";
    } catch (_error) {
      return "";
    }
  }

  function formatMessage(template, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];

    return String(template).replace(/\{(\d+)\}/g, (match, indexText) => {
      const index = Number(indexText);
      return values[index] == null ? match : String(values[index]);
    });
  }

  function t(key, substitutions = [], fallback = "") {
    const message =
      getLoadedMessage(key) ||
      getChromeMessage(key) ||
      getLoadedEnglishMessage(key) ||
      fallback ||
      key;
    return formatMessage(message, substitutions);
  }

  function getLoadedMessage(key) {
    if (!key || !currentMessages) {
      return "";
    }

    return currentMessages[key] || "";
  }

  function getLoadedEnglishMessage(key) {
    if (!key || currentLocaleId === DEFAULT_LANGUAGE) {
      return "";
    }

    const englishMessages = messageBundleCache.get(DEFAULT_LANGUAGE);
    return englishMessages?.[key] || "";
  }

  function getUiLanguage() {
    try {
      return (
        globalThis.chrome?.i18n?.getUILanguage?.() ||
        globalThis.navigator?.language ||
        DEFAULT_LANGUAGE
      );
    } catch (_error) {
      return DEFAULT_LANGUAGE;
    }
  }

  function normalizeLanguageMode(value) {
    return LANGUAGE_MODE_VALUES.includes(value) ? value : "auto";
  }

  function resolveLocaleId(languageMode = currentLanguageMode) {
    const normalizedMode = normalizeLanguageMode(languageMode);
    return normalizedMode === "auto" ? normalizeLocaleId(getUiLanguage()) : normalizedMode;
  }

  function normalizeLocaleId(language) {
    const normalized = String(language || "")
      .replace("_", "-")
      .toLowerCase();

    if (normalized.startsWith("zh-tw") || normalized.startsWith("zh-hk") || normalized.startsWith("zh-mo")) {
      return "zh_TW";
    }
    if (normalized.startsWith("zh")) {
      return "zh_CN";
    }
    if (normalized.startsWith("pt-br")) {
      return "pt_BR";
    }

    const primaryLanguage = normalized.split("-")[0];
    return SUPPORTED_LOCALE_IDS.includes(primaryLanguage) ? primaryLanguage : DEFAULT_LANGUAGE;
  }

  function normalizeHtmlLanguage(language) {
    const localeId = normalizeLocaleId(language);
    if (localeId === "zh_CN") {
      return "zh-CN";
    }
    if (localeId === "zh_TW") {
      return "zh-TW";
    }
    if (localeId === "pt_BR") {
      return "pt-BR";
    }
    return localeId;
  }

  async function initialize() {
    if (!initializePromise) {
      initializePromise = readStoredLanguageMode()
        .then((languageMode) => setLanguageMode(languageMode))
        .catch(async () => {
          await setLanguageMode("auto");
          return getState();
        });
    }

    return initializePromise;
  }

  async function readStoredLanguageMode() {
    const storage = globalThis.chrome?.storage?.local;

    if (!storage?.get) {
      return "auto";
    }

    const stored = await storage.get({
      [SETTINGS_STORAGE_KEY]: null,
    });
    return normalizeLanguageMode(stored?.[SETTINGS_STORAGE_KEY]?.appearance?.languageMode);
  }

  async function setLanguageMode(languageMode) {
    currentLanguageMode = normalizeLanguageMode(languageMode);
    currentLocaleId = resolveLocaleId(currentLanguageMode);
    currentMessages = await loadLocaleBundleWithFallback(currentLocaleId);
    return getState();
  }

  async function loadLocaleBundleWithFallback(localeId) {
    try {
      const messages = await loadLocaleBundle(localeId);

      if (localeId !== DEFAULT_LANGUAGE && !messageBundleCache.has(DEFAULT_LANGUAGE)) {
        void loadLocaleBundle(DEFAULT_LANGUAGE).catch(() => null);
      }

      return messages;
    } catch (_error) {
      currentLocaleId = DEFAULT_LANGUAGE;
      try {
        return await loadLocaleBundle(DEFAULT_LANGUAGE);
      } catch (_fallbackError) {
        return {};
      }
    }
  }

  async function loadLocaleBundle(localeId) {
    const normalizedLocaleId = SUPPORTED_LOCALE_IDS.includes(localeId)
      ? localeId
      : DEFAULT_LANGUAGE;

    if (messageBundleCache.has(normalizedLocaleId)) {
      return messageBundleCache.get(normalizedLocaleId);
    }

    if (typeof fetch !== "function" || !globalThis.chrome?.runtime?.getURL) {
      const emptyMessages = {};
      messageBundleCache.set(normalizedLocaleId, emptyMessages);
      return emptyMessages;
    }

    const response = await fetch(
      globalThis.chrome.runtime.getURL(`_locales/${normalizedLocaleId}/messages.json`)
    );

    if (!response.ok) {
      throw new Error(`Could not load locale bundle: ${normalizedLocaleId}`);
    }

    const rawMessages = await response.json();
    const messages = {};

    for (const [key, value] of Object.entries(rawMessages || {})) {
      if (typeof value?.message === "string") {
        messages[key] = value.message;
      }
    }

    messageBundleCache.set(normalizedLocaleId, messages);
    return messages;
  }

  function applyDocument(root = globalThis.document) {
    const documentRef = root?.ownerDocument || root;

    if (!documentRef?.querySelectorAll) {
      return;
    }

    const htmlElement = documentRef.documentElement;

    if (htmlElement) {
      htmlElement.lang = localeIdToHtmlLanguage(currentLocaleId);
    }

    applyTextBindings(root, "data-i18n", (element, value) => {
      element.textContent = value;
    });
    applyTextBindings(root, "data-i18n-title", (element, value) => {
      element.title = value;
    });
    applyTextBindings(root, "data-i18n-aria-label", (element, value) => {
      element.setAttribute("aria-label", value);
    });
    applyTextBindings(root, "data-i18n-placeholder", (element, value) => {
      element.setAttribute("placeholder", value);
    });
  }

  function applyTextBindings(root, attributeName, applyValue) {
    const elements = root.querySelectorAll(`[${attributeName}]`);

    for (const element of elements) {
      const key = element.getAttribute(attributeName);
      const fallback = element.getAttribute(`${attributeName}-fallback`) || element.textContent || "";
      const value = t(key, [], fallback);

      if (value) {
        applyValue(element, value);
      }
    }
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
    return SUPPORTED_LOCALE_IDS.includes(localeId) ? localeId : DEFAULT_LANGUAGE;
  }

  function getState() {
    return {
      languageMode: currentLanguageMode,
      localeId: currentLocaleId,
      htmlLanguage: localeIdToHtmlLanguage(currentLocaleId),
    };
  }

  globalThis.ZeroLatencyI18n = {
    DEFAULT_LANGUAGE,
    LANGUAGE_MODE_VALUES,
    LANGUAGE_OPTIONS,
    t,
    initialize,
    setLanguageMode,
    applyDocument,
    getUiLanguage,
    getState,
    normalizeLanguageMode,
    normalizeLocaleId,
    normalizeHtmlLanguage,
  };
})();
