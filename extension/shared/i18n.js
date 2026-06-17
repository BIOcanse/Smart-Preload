(() => {
  const constants = globalThis.ZeroLatencyI18nConstants;
  const localeApi = globalThis.ZeroLatencyI18nLocale;
  const messageApi = globalThis.ZeroLatencyI18nMessages;
  const domApi = globalThis.ZeroLatencyI18nDom;

  let currentLanguageMode = "auto";
  let currentLocaleId = constants.DEFAULT_LANGUAGE;
  let currentMessages = null;
  let initializePromise = null;

  function t(key, substitutions = [], fallback = "") {
    return messageApi.resolveMessage(
      key,
      substitutions,
      fallback,
      currentMessages,
      currentLocaleId
    );
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
      [constants.SETTINGS_STORAGE_KEY]: null,
    });
    return localeApi.normalizeLanguageMode(
      stored?.[constants.SETTINGS_STORAGE_KEY]?.appearance?.languageMode
    );
  }

  async function setLanguageMode(languageMode) {
    currentLanguageMode = localeApi.normalizeLanguageMode(languageMode);
    const targetLocaleId = localeApi.resolveLocaleId(currentLanguageMode);
    const loaded = await messageApi.loadLocaleBundleWithFallback(targetLocaleId);
    currentLocaleId = loaded.localeId;
    currentMessages = loaded.messages;
    return getState();
  }

  function applyDocument(root = globalThis.document) {
    domApi.applyDocument(root, currentLocaleId, t);
  }

  function getState() {
    return {
      languageMode: currentLanguageMode,
      localeId: currentLocaleId,
      htmlLanguage: localeApi.localeIdToHtmlLanguage(currentLocaleId),
    };
  }

  globalThis.ZeroLatencyI18n = {
    DEFAULT_LANGUAGE: constants.DEFAULT_LANGUAGE,
    LANGUAGE_MODE_VALUES: constants.LANGUAGE_MODE_VALUES,
    LANGUAGE_OPTIONS: constants.LANGUAGE_OPTIONS,
    t,
    initialize,
    setLanguageMode,
    applyDocument,
    getUiLanguage: localeApi.getUiLanguage,
    getState,
    normalizeLanguageMode: localeApi.normalizeLanguageMode,
    normalizeLocaleId: localeApi.normalizeLocaleId,
    normalizeHtmlLanguage: localeApi.normalizeHtmlLanguage,
  };
})();
