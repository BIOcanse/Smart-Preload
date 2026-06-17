(function () {
  const { isPlainObject, clamp } = globalThis.ZeroLatencySettingsUtils;
  const {
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizeRuleOperator(value, fallback) {
    return RULE_CONDITION_OPERATOR_VALUES.includes(value) ? value : fallback;
  }

  function normalizeRuleStatus(value, fallback) {
    return RULE_STATUS_VALUES.includes(value) ? value : fallback;
  }

  function isRuleCardEnabled(cardState) {
    return isPlainObject(cardState) && normalizeRuleStatus(cardState.status, "enabled") === "enabled";
  }

  function compareRuleValues(leftValue, operator, rightValue) {
    const normalizedOperator = normalizeRuleOperator(operator, "disabled");

    if (normalizedOperator === "disabled") {
      return true;
    }

    const numericLeft = Number(leftValue);
    const numericRight = Number(rightValue);

    if (!Number.isFinite(numericLeft) || !Number.isFinite(numericRight)) {
      return false;
    }

    switch (normalizedOperator) {
      case "gt":
        return numericLeft > numericRight;
      case "gte":
        return numericLeft >= numericRight;
      case "eq":
        return numericLeft === numericRight;
      case "lte":
        return numericLeft <= numericRight;
      case "lt":
        return numericLeft < numericRight;
      default:
        return true;
    }
  }

  function evaluateRuleCardMetric(cardState, metricValue) {
    if (!isRuleCardEnabled(cardState)) {
      return true;
    }

    const leftPassed =
      cardState.operatorA === "disabled"
        ? true
        : compareRuleValues(cardState.valueA, cardState.operatorA, metricValue);
    const rightPassed =
      cardState.operatorB === "disabled"
        ? true
        : compareRuleValues(metricValue, cardState.operatorB, cardState.valueC);

    return leftPassed && rightPassed;
  }

  function derivePreloadCapFromRuleCard(cardState, fallback) {
    const defaultFallback = Number.isFinite(Number(fallback))
      ? Number(fallback)
      : DEFAULT_SETTINGS.preloading.maxTabsPerSource;
    const fallbackValue = clamp(
      defaultFallback,
      1,
      20,
      DEFAULT_SETTINGS.preloading.maxTabsPerSource
    );

    if (!isPlainObject(cardState)) {
      return fallbackValue;
    }

    const normalizedCard = {
      valueA: clamp(cardState.valueA, 0, 9999, 0),
      operatorA: normalizeRuleOperator(cardState.operatorA, "disabled"),
      operatorB: normalizeRuleOperator(cardState.operatorB, "lte"),
      valueC: clamp(cardState.valueC, 0, 9999, fallbackValue),
      status: normalizeRuleStatus(cardState.status, "enabled"),
    };

    if (normalizedCard.status !== "enabled") {
      return fallbackValue;
    }

    if (["lt", "lte", "eq"].includes(normalizedCard.operatorB)) {
      return clamp(normalizedCard.valueC, 1, 20, fallbackValue);
    }

    if (["gt", "gte", "eq"].includes(normalizedCard.operatorA)) {
      return clamp(normalizedCard.valueA, 1, 20, fallbackValue);
    }

    return fallbackValue;
  }

  function deriveSiteSelectionLimitFromRuleCard(cardState, fallback) {
    const fallbackValue = clamp(
      fallback,
      1,
      20,
      DEFAULT_SETTINGS.preloading.siteSelectionLimit
    );

    if (!isPlainObject(cardState)) {
      return fallbackValue;
    }

    const normalizedCard = {
      valueA: clamp(cardState.valueA, 0, 9999, 0),
      operatorA: normalizeRuleOperator(cardState.operatorA, "disabled"),
      operatorB: normalizeRuleOperator(cardState.operatorB, "lte"),
      valueC: clamp(cardState.valueC, 0, 9999, fallbackValue),
      status: normalizeRuleStatus(cardState.status, "enabled"),
    };

    if (normalizedCard.status !== "enabled") {
      return fallbackValue;
    }

    if (["lt", "lte", "eq"].includes(normalizedCard.operatorB)) {
      return clamp(normalizedCard.valueC, 1, 20, fallbackValue);
    }

    if (["gt", "gte", "eq"].includes(normalizedCard.operatorA)) {
      return clamp(normalizedCard.valueA, 1, 20, fallbackValue);
    }

    return fallbackValue;
  }

  globalThis.ZeroLatencySettingsRules = {
    normalizeRuleOperator,
    normalizeRuleStatus,
    isRuleCardEnabled,
    compareRuleValues,
    evaluateRuleCardMetric,
    derivePreloadCapFromRuleCard,
    deriveSiteSelectionLimitFromRuleCard,
  };
})();
