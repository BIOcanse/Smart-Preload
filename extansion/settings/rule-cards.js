(() => {
  const ui = globalThis.ZeroLatencySettingsUi;
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function renderRuleCardList({
    container,
    cardIds,
    settings,
    ruleCardSchema,
    translate = defaultTranslate,
  }) {
    if (!container) {
      return;
    }

    container.textContent = "";

    for (const cardId of cardIds) {
      const cardSchema = ruleCardSchema[cardId];
      const cardState = settings.layout.ruleCards.items?.[cardId];

      if (!cardSchema || !cardState) {
        continue;
      }

      const item = document.createElement("article");
      item.className = "settings-item rule-card preload-rule-card";
      item.dataset.cardId = cardId;

      const info = document.createElement("div");
      info.className = "settings-item-info";

      info.append(
        ui.createSettingLabelElement({
          text: cardSchema.title,
          helpText: cardSchema.description,
          translate,
        })
      );

      const controlArea = document.createElement("div");
      controlArea.className = "settings-item-control rule-card-control";
      controlArea.append(createRuleControlWidget({ cardId, cardSchema, cardState, translate }));
      item.append(info, controlArea);
      container.append(item);
    }
  }

  function createRuleControlWidget({
    cardId,
    cardSchema,
    cardState,
    translate = defaultTranslate,
  }) {
    const control = document.createElement("div");
    control.className = "rule-control rule-controls";

    for (const field of cardSchema.fields) {
      const value = cardState[field.key];
      const fieldShell = document.createElement("label");
      fieldShell.className = "rule-slot";
      fieldShell.title = field.label;

      if (field.type === "number") {
        const isDisabled = isRuleNumberFieldDisabled(cardState, field.key);
        const input = document.createElement("input");
        input.type = "number";
        input.className = "number-input rule-input";
        input.min = String(field.min ?? 0);
        input.max = String(field.max ?? 9999);
        input.value = String(value ?? field.min ?? 0);
        input.placeholder = field.label;
        input.dataset.cardId = cardId;
        input.dataset.fieldKey = field.key;
        input.disabled = isDisabled;
        fieldShell.classList.toggle("is-disabled", isDisabled);
        fieldShell.append(input);
      } else if (field.type === "select") {
        const select = document.createElement("select");
        select.className = "select-input rule-select";
        select.dataset.cardId = cardId;
        select.dataset.fieldKey = field.key;

        for (const optionSpec of field.options) {
          const option = document.createElement("option");
          option.value = String(optionSpec.value);
          option.textContent = optionSpec.label;
          option.selected = String(optionSpec.value) === String(value);
          select.append(option);
        }

        fieldShell.append(select);
      } else if (field.type === "status-toggle") {
        fieldShell.classList.add("is-toggle");

        const switchLabel = document.createElement("span");
        switchLabel.className = "switch";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value === "enabled";
        input.dataset.cardId = cardId;
        input.dataset.fieldKey = field.key;
        input.setAttribute("aria-label", `${cardSchema.title} ${field.label}`);

        const track = document.createElement("span");
        track.className = "switch-track";

        switchLabel.append(input, track);
        fieldShell.append(switchLabel);
      } else if (field.type === "token") {
        fieldShell.classList.add("is-token");

        const token = document.createElement("input");
        token.type = "text";
        token.className = "number-input rule-input rule-token";
        token.value = field.text;
        token.readOnly = true;
        token.tabIndex = -1;
        token.setAttribute(
          "aria-label",
          `${cardSchema.title} ${translate("ruleTokenFixed", [field.text], `fixed token ${field.text}`)}`
        );
        fieldShell.append(token);
      }

      control.append(fieldShell);
    }

    return control;
  }

  function isRuleNumberFieldDisabled(cardState, fieldKey) {
    if (fieldKey === "valueA") {
      return cardState.operatorA === "disabled";
    }

    if (fieldKey === "valueC") {
      return cardState.operatorB === "disabled";
    }

    return false;
  }

  globalThis.ZeroLatencySettingsRuleCards = {
    renderRuleCardList,
    createRuleControlWidget,
    isRuleNumberFieldDisabled,
  };
})();
