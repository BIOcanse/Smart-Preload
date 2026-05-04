(() => {
  const DEFAULT_LANGUAGE = "en";

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
    const message = getChromeMessage(key) || fallback || key;
    return formatMessage(message, substitutions);
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

  function normalizeHtmlLanguage(language) {
    return /^zh\b/i.test(language) ? "zh-CN" : "en";
  }

  function applyDocument(root = globalThis.document) {
    const documentRef = root?.ownerDocument || root;

    if (!documentRef?.querySelectorAll) {
      return;
    }

    const htmlElement = documentRef.documentElement;

    if (htmlElement) {
      htmlElement.lang = normalizeHtmlLanguage(getUiLanguage());
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

  globalThis.ZeroLatencyI18n = {
    t,
    applyDocument,
    getUiLanguage,
    normalizeHtmlLanguage,
  };
})();
