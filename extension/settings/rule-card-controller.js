(() => {
  const RULE_CARD_INPUT_DEBOUNCE_MS = 250;
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
    const pendingInputs = new Map();

    function bind() {
      containers?.preload?.addEventListener("input", routeRuleCardEvent);
      containers?.preload?.addEventListener("change", routeRuleCardEvent);
      containers?.tracking?.addEventListener("input", routeRuleCardEvent);
      containers?.tracking?.addEventListener("change", routeRuleCardEvent);
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

    function routeRuleCardEvent(event) {
      const input = event.target?.closest?.(
        "input[data-card-id][data-field-key], select[data-card-id][data-field-key]"
      );

      if (!input || !shouldHandleRuleCardEvent(event.type, input)) {
        return;
      }

      if (event.type === "input") {
        scheduleRuleCardInput(input);
        return;
      }

      flushPendingChanges();
      applyRuleCardInput(input);
    }

    function scheduleRuleCardInput(input) {
      const pendingTimerId = pendingInputs.get(input);

      if (pendingTimerId) {
        clearTimeout(pendingTimerId);
      }

      pendingInputs.set(
        input,
        setTimeout(() => {
          pendingInputs.delete(input);
          applyRuleCardInput(input);
        }, RULE_CARD_INPUT_DEBOUNCE_MS)
      );
    }

    function flushPendingChanges() {
      const inputs = Array.from(pendingInputs.keys());
      cancelPendingChanges();

      for (const input of inputs) {
        applyRuleCardInput(input);
      }
    }

    function cancelPendingChanges() {
      for (const timerId of pendingInputs.values()) {
        clearTimeout(timerId);
      }
      pendingInputs.clear();
    }

    function handleRuleCardInput(event) {
      const input = event?.target?.closest?.(
        "input[data-card-id][data-field-key], select[data-card-id][data-field-key]"
      );

      if (input) {
        applyRuleCardInput(input);
      }
    }

    function applyRuleCardInput(input) {
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
      flushPendingChanges,
      cancelPendingChanges,
      updateRuleCardField,
    };
  }

  function shouldHandleRuleCardEvent(eventType, input) {
    const tagName = String(input?.tagName || "").toUpperCase();
    const inputType = String(input?.type || "").toLowerCase();
    const expectedEvent =
      tagName === "SELECT" || inputType === "checkbox" || inputType === "radio"
        ? "change"
        : "input";

    return eventType === expectedEvent;
  }

  globalThis.ZeroLatencySettingsRuleCardController = {
    RULE_CARD_INPUT_DEBOUNCE_MS,
    create: createRuleCardController,
    shouldHandleRuleCardEvent,
  };
})();
