(() => {
  const localeApi = globalThis.ZeroLatencyI18nLocale;

  function applyDocument(root, localeId, translate) {
    const documentRef = root?.ownerDocument || root;

    if (!documentRef?.querySelectorAll) {
      return;
    }

    const htmlElement = documentRef.documentElement;

    if (htmlElement) {
      htmlElement.lang = localeApi.localeIdToHtmlLanguage(localeId);
    }

    applyTextBindings(root, "data-i18n", translate, (element, value) => {
      element.textContent = value;
    });
    applyTextBindings(root, "data-i18n-title", translate, (element, value) => {
      element.title = value;
    });
    applyTextBindings(root, "data-i18n-aria-label", translate, (element, value) => {
      element.setAttribute("aria-label", value);
    });
    applyTextBindings(root, "data-i18n-placeholder", translate, (element, value) => {
      element.setAttribute("placeholder", value);
    });
  }

  function applyTextBindings(root, attributeName, translate, applyValue) {
    const elements = root.querySelectorAll(`[${attributeName}]`);

    for (const element of elements) {
      const key = element.getAttribute(attributeName);
      const fallback =
        element.getAttribute(`${attributeName}-fallback`) || element.textContent || "";
      const value = translate(key, [], fallback);

      if (value) {
        applyValue(element, value);
      }
    }
  }

  globalThis.ZeroLatencyI18nDom = {
    applyDocument,
    applyTextBindings,
  };
})();
