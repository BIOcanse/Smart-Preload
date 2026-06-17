(function () {
  const constants = globalThis.ZeroLatencySettingsSchemaConstants;
  const { localize } = globalThis.ZeroLatencySettingsSchemaLocalize;
  const {
    createProxySkipModeOptions,
    createTransitionWindowOptions,
    createRuleOperatorOptions,
    replaceArrayValues,
    replaceObjectValues,
  } = globalThis.ZeroLatencySettingsSchemaOptions;
  const { createRuleCardSchema } = globalThis.ZeroLatencySettingsSchemaRuleCards;
  const {
    SETTINGS_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    AI_MODEL_CATALOG,
    PRELOAD_RULE_CARD_IDS,
    TRACKING_RULE_CARD_IDS,
    RULE_CARD_IDS,
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    PROXY_SKIP_MODE_VALUES,
    LANGUAGE_MODE_VALUES,
    TRANSITION_WINDOW_VALUES,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
  } = constants;

  const PROXY_SKIP_MODE_OPTIONS = [];
  const TRANSITION_WINDOW_OPTIONS = [];
  const RULE_OPERATOR_OPTIONS = [];
  const RULE_CARD_SCHEMA = {};

  function refreshLocalizedText() {
    replaceArrayValues(PROXY_SKIP_MODE_OPTIONS, createProxySkipModeOptions());
    replaceArrayValues(TRANSITION_WINDOW_OPTIONS, createTransitionWindowOptions());
    replaceArrayValues(RULE_OPERATOR_OPTIONS, createRuleOperatorOptions());
    replaceObjectValues(RULE_CARD_SCHEMA, createRuleCardSchema(RULE_OPERATOR_OPTIONS));
  }

  refreshLocalizedText();

  globalThis.ZeroLatencySettingsSchema = {
    SETTINGS_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    PRELOAD_RULE_CARD_IDS,
    TRACKING_RULE_CARD_IDS,
    RULE_CARD_IDS,
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    PROXY_SKIP_MODE_VALUES,
    LANGUAGE_MODE_VALUES,
    PROXY_SKIP_MODE_OPTIONS,
    TRANSITION_WINDOW_VALUES,
    TRANSITION_WINDOW_OPTIONS,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
    AI_MODEL_CATALOG,
    RULE_OPERATOR_OPTIONS,
    RULE_CARD_SCHEMA,
    refreshLocalizedText,
    localize,
  };
})();
