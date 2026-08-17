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
      const explicitFallback = element.getAttribute(`${attributeName}-fallback`);
      // 首次应用时把**原始**文本冻结进一个属性。
      //
      // 此前 fallback 直接取 element.textContent —— 而 applyDocument() 跑过一次之后，
      // textContent 已经是上一次的译文。于是切换语言时，「fallback」变成了**上一个语言**
      // 的文本，而不是原始英文。当前潜伏（366 个 key 十种语言齐全，locale-key-alignment
      // 测试保证），一旦某个 key 只加进 en 就会显现。
      const frozenFallbackAttribute = `${attributeName}-original`;

      if (explicitFallback === null && !element.hasAttribute(frozenFallbackAttribute)) {
        element.setAttribute(frozenFallbackAttribute, element.textContent || "");
      }

      const fallback =
        explicitFallback ?? element.getAttribute(frozenFallbackAttribute) ?? "";
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
