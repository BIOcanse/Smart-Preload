(() => {
  const {
    clamp,
    isPlainObject,
    mergeSettings,
  } = globalThis.ZeroLatencySettingsUtils;
  const {
    LANGUAGE_MODE_VALUES,
    RULE_CARD_IDS,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;
  const {
    normalizeRuleOperator,
    normalizeRuleStatus,
  } = globalThis.ZeroLatencySettingsRules;

  function normalizeAppearanceSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.appearance, value);

    return {
      languageMode: normalizeLanguageMode(mergedValue.languageMode),
    };
  }

  function normalizeLanguageMode(value) {
    return LANGUAGE_MODE_VALUES.includes(value)
      ? value
      : DEFAULT_SETTINGS.appearance.languageMode;
  }

  function normalizeLayoutSettings(layoutSettings) {
    const rawRuleCards = isPlainObject(layoutSettings?.ruleCards)
      ? layoutSettings.ruleCards
      : {};
    const rawItems = isPlainObject(rawRuleCards.items)
      ? rawRuleCards.items
      : {};

    return {
      ruleCards: {
        items: normalizeRuleCardItems(rawItems),
      },
    };
  }

  function normalizeRuleCardItems(rawItems) {
    const nextItems = {};
    const providedItems = isPlainObject(rawItems) ? rawItems : {};

    for (const cardId of RULE_CARD_IDS) {
      const mergedItem = mergeSettings(
        DEFAULT_SETTINGS.layout.ruleCards.items[cardId],
        providedItems[cardId]
      );

      nextItems[cardId] = {
        valueA: clamp(
          mergedItem.valueA,
          0,
          9999,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].valueA
        ),
        operatorA: normalizeRuleOperator(
          mergedItem.operatorA,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].operatorA
        ),
        valueB: clamp(
          mergedItem.valueB,
          0,
          9999,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].valueB
        ),
        operatorB: normalizeRuleOperator(
          mergedItem.operatorB,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].operatorB
        ),
        valueC: clamp(
          mergedItem.valueC,
          0,
          9999,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].valueC
        ),
        status: normalizeRuleStatus(
          mergedItem.status,
          DEFAULT_SETTINGS.layout.ruleCards.items[cardId].status
        ),
      };
    }

    return nextItems;
  }

  globalThis.ZeroLatencySettingsNormalizeAppearanceLayout = {
    normalizeAppearanceSettings,
    normalizeLanguageMode,
    normalizeLayoutSettings,
    normalizeRuleCardItems,
  };
})();
