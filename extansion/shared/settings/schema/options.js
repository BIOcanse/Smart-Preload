(function () {
  const { localize } = globalThis.ZeroLatencySettingsSchemaLocalize;

  function createProxySkipModeOptions() {
    return [
      { value: "blacklist", label: localize("settingsProxySkipModeBlacklist", "Blacklist") },
      { value: "whitelist", label: localize("settingsProxySkipModeWhitelist", "Whitelist") },
    ];
  }

  function createTransitionWindowOptions() {
    return [
      { value: "total", label: localize("transitionWindowTotal", "Total") },
      { value: "last365d", label: localize("transitionWindow365d", "Last year") },
      { value: "last30d", label: localize("transitionWindow30d", "Last month") },
      { value: "last7d", label: localize("transitionWindow7d", "Last 7 days") },
      { value: "last1d", label: localize("transitionWindow1d", "Last day") },
    ];
  }

  function createRuleOperatorOptions() {
    return [
      { value: "disabled", label: localize("ruleOperatorDisabled", "Disabled") },
      { value: "gt", label: ">" },
      { value: "gte", label: ">=" },
      { value: "eq", label: "=" },
      { value: "lte", label: "<=" },
      { value: "lt", label: "<" },
    ];
  }

  function replaceArrayValues(target, values) {
    target.splice(0, target.length, ...values);
  }

  function replaceObjectValues(target, values) {
    for (const key of Object.keys(target)) {
      delete target[key];
    }
    Object.assign(target, values);
  }

  globalThis.ZeroLatencySettingsSchemaOptions = {
    createProxySkipModeOptions,
    createTransitionWindowOptions,
    createRuleOperatorOptions,
    replaceArrayValues,
    replaceObjectValues,
  };
})();
