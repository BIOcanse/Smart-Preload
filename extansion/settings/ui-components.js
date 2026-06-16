(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function createSettingLabelElement({ text, helpText, htmlFor, translate = defaultTranslate } = {}) {
    const labelElement = document.createElement(htmlFor ? "label" : "p");
    labelElement.className = "settings-item-label settings-item-label-row";

    if (htmlFor) {
      labelElement.setAttribute("for", htmlFor);
    }

    const textElement = document.createElement("span");
    textElement.className = "settings-item-label-text";
    textElement.textContent = String(text || "");
    labelElement.append(textElement);

    if (typeof helpText === "string" && helpText.trim()) {
      labelElement.append(createSettingsHelpIcon(helpText.trim(), text, { translate }));
    }

    return labelElement;
  }

  function createSettingsHelpIcon(helpText, labelText, { translate = defaultTranslate } = {}) {
    const helpElement = document.createElement("span");
    helpElement.className = "settings-help";
    helpElement.tabIndex = 0;
    helpElement.setAttribute("role", "img");
    helpElement.setAttribute(
      "aria-label",
      `${labelText || translate("commonHelp", [], "Help")}: ${helpText}`
    );
    helpElement.textContent = "?";
    helpElement.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const tooltip = document.createElement("span");
    tooltip.className = "settings-help-tooltip";
    tooltip.textContent = helpText;
    helpElement.append(tooltip);

    return helpElement;
  }

  function compactInlineSettingDescriptions(root = document, { translate = defaultTranslate } = {}) {
    const infoBlocks = Array.from(root.querySelectorAll(".settings-item-info"));

    for (const infoBlock of infoBlocks) {
      const labelElement = infoBlock.querySelector(".settings-item-label");
      const descriptionElement = infoBlock.querySelector(".settings-item-desc");

      if (!labelElement) {
        continue;
      }

      if (labelElement.dataset.helpI18nKey || labelElement.dataset.helpFallback) {
        const helpText = labelElement.dataset.helpI18nKey
          ? translate(labelElement.dataset.helpI18nKey, [], labelElement.dataset.helpFallback || "")
          : labelElement.dataset.helpFallback || "";

        labelElement.querySelector(".settings-help")?.remove();

        if (helpText.trim()) {
          labelElement.classList.add("settings-item-label-row");
          labelElement.append(createSettingsHelpIcon(helpText.trim(), labelElement.textContent.trim(), { translate }));
        }

        descriptionElement?.remove();
        continue;
      }

      if (!descriptionElement || labelElement.querySelector(".settings-help")) {
        continue;
      }

      const helpText = descriptionElement.textContent.trim();

      if (!helpText) {
        descriptionElement.remove();
        continue;
      }

      labelElement.dataset.helpI18nKey = descriptionElement.getAttribute("data-i18n") || "";
      labelElement.dataset.helpFallback =
        descriptionElement.getAttribute("data-i18n-fallback") || helpText;
      labelElement.classList.add("settings-item-label-row");
      labelElement.append(createSettingsHelpIcon(helpText, labelElement.textContent.trim(), { translate }));
      descriptionElement.remove();
    }
  }

  globalThis.ZeroLatencySettingsUi = {
    createSettingLabelElement,
    createSettingsHelpIcon,
    compactInlineSettingDescriptions,
  };
})();
