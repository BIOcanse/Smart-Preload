(() => {
  const constants = globalThis.ZeroLatencyI18nConstants;
  const messageBundleCache = new Map();

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

  function resolveMessage(key, substitutions, fallback, currentMessages, currentLocaleId) {
    const message =
      getLoadedMessage(key, currentMessages) ||
      getChromeMessage(key) ||
      getLoadedEnglishMessage(key, currentLocaleId) ||
      fallback ||
      key;
    return formatMessage(message, substitutions);
  }

  function getLoadedMessage(key, currentMessages) {
    if (!key || !currentMessages) {
      return "";
    }

    return currentMessages[key] || "";
  }

  function getLoadedEnglishMessage(key, currentLocaleId) {
    if (!key || currentLocaleId === constants.DEFAULT_LANGUAGE) {
      return "";
    }

    const englishMessages = messageBundleCache.get(constants.DEFAULT_LANGUAGE);
    return englishMessages?.[key] || "";
  }

  async function loadLocaleBundleWithFallback(localeId) {
    try {
      const messages = await loadLocaleBundle(localeId);

      if (
        localeId !== constants.DEFAULT_LANGUAGE &&
        !messageBundleCache.has(constants.DEFAULT_LANGUAGE)
      ) {
        void loadLocaleBundle(constants.DEFAULT_LANGUAGE).catch(() => null);
      }

      return {
        localeId,
        messages,
      };
    } catch (_error) {
      try {
        return {
          localeId: constants.DEFAULT_LANGUAGE,
          messages: await loadLocaleBundle(constants.DEFAULT_LANGUAGE),
        };
      } catch (_fallbackError) {
        return {
          localeId: constants.DEFAULT_LANGUAGE,
          messages: {},
        };
      }
    }
  }

  async function loadLocaleBundle(localeId) {
    const normalizedLocaleId = constants.SUPPORTED_LOCALE_IDS.includes(localeId)
      ? localeId
      : constants.DEFAULT_LANGUAGE;

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

  globalThis.ZeroLatencyI18nMessages = {
    getChromeMessage,
    formatMessage,
    resolveMessage,
    loadLocaleBundleWithFallback,
    loadLocaleBundle,
  };
})();
