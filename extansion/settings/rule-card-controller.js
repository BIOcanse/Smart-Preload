(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function createRuleCardController({
    containers,
    preloadCardIds,
    trackingCardIds,
    ruleCardSchema,
    settingsApi,
    renderer,
    statusBar,
    translate = defaultTranslate,
    getDraftSettings,
    setDraftSettings,
  }) {
    function bind() {
      containers?.preload?.addEventListener("input", handleRuleCardInput);
      containers?.preload?.addEventListener("change", handleRuleCardInput);
      containers?.tracking?.addEventListener("input", handleRuleCardInput);
      containers?.tracking?.addEventListener("change", handleRuleCardInput);
    }

    function renderRuleCards(settings) {
      renderRuleCardList(containers?.preload, preloadCardIds, settings);
      renderRuleCardList(containers?.tracking, trackingCardIds, settings);
    }

    function renderRuleCardList(container, cardIds, settings) {
      renderer.renderRuleCardList({
        container,
        cardIds,
        settings,
        ruleCardSchema,
        translate,
      });
    }

    function handleRuleCardInput(event) {
      const input = event.target.closest(
        "input[data-card-id][data-field-key], select[data-card-id][data-field-key]"
      );

      if (!input) {
        return;
      }

      const { cardId, fieldKey } = input.dataset;
      const cardSchema = ruleCardSchema[cardId];
      const fieldSchema = cardSchema?.fields.find((field) => field.key === fieldKey);

      if (!cardSchema || !fieldSchema) {
        return;
      }

      const nextValue =
        input.type === "checkbox"
          ? input.checked
            ? "enabled"
            : "disabled"
          : input.tagName === "SELECT"
            ? input.value
            : Number(input.value || 0);

      const nextSettings = settingsApi.normalizeStoredSettings(
        updateRuleCardField(getDraftSettings(), cardId, fieldKey, nextValue)
      );
      setDraftSettings(nextSettings);

      if (fieldSchema.type === "number") {
        input.value = String(nextSettings.layout.ruleCards.items[cardId][fieldKey]);
      }

      if (fieldSchema.type === "select") {
        renderRuleCards(nextSettings);
      }

      if (statusBar.isDirty()) {
        statusBar.setDirtyStatus(
          translate("settingsUnsavedReady", [], "Unsaved changes are ready to be applied.")
        );
      } else {
        statusBar.setStatus(
          translate("commonReady", [], "Ready"),
          translate("settingsNoUnsavedChanges", [], "No unsaved changes.")
        );
      }
    }

    function updateRuleCardField(source, cardId, fieldKey, value) {
      const nextState = settingsApi.cloneSettings(source);

      if (!nextState.layout?.ruleCards?.items?.[cardId]) {
        return nextState;
      }

      nextState.layout.ruleCards.items[cardId][fieldKey] = value;
      return nextState;
    }

    return {
      bind,
      renderRuleCards,
      handleRuleCardInput,
      updateRuleCardField,
    };
  }

  globalThis.ZeroLatencySettingsRuleCardController = {
    create: createRuleCardController,
  };
})();
