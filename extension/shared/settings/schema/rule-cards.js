(function () {
  const { localize } = globalThis.ZeroLatencySettingsSchemaLocalize;

  function createRuleFields(tokenText, ruleOperatorOptions) {
    return [
      {
        key: "valueA",
        type: "number",
        min: 0,
        max: 9999,
        label: localize("ruleFieldValueA", "Value A"),
      },
      {
        key: "operatorA",
        type: "select",
        options: ruleOperatorOptions,
        label: localize("ruleFieldCompareA", "Compare A"),
      },
      { key: "tokenX", type: "token", text: tokenText, label: tokenText },
      {
        key: "operatorB",
        type: "select",
        options: ruleOperatorOptions,
        label: localize("ruleFieldCompareB", "Compare B"),
      },
      {
        key: "valueC",
        type: "number",
        min: 0,
        max: 9999,
        label: localize("ruleFieldValueC", "Value C"),
      },
      {
        key: "status",
        type: "status-toggle",
        label: localize("ruleFieldStatus", "Status"),
      },
    ];
  }

  function createRuleCardSchema(ruleOperatorOptions) {
    return {
      nativePerPagePreloadLimit: {
        title: localize("ruleNativePerPageTitle", "Browser-native preload group page slot cap a"),
        description: localize(
          "ruleNativePerPageDesc",
          "Applies to browser-native `prefetch` / `prerender` candidates. It decides how many page candidates this group can keep for final execution."
        ),
        fields: createRuleFields("a", ruleOperatorOptions),
      },
      perPagePreloadLimit: {
        title: localize("ruleTabPerPageTitle", "Real Preload group page slot cap a"),
        description: localize(
          "ruleTabPerPageDesc",
          "Applies to candidates that need hidden real background tabs. It decides how many page candidates this group can keep for final execution."
        ),
        fields: createRuleFields("a", ruleOperatorOptions),
      },
      highWeightRank: {
        title: localize("ruleNativeSiteTitle", "Browser-native preload group high-weight site count x"),
        description: localize(
          "ruleNativeSiteDesc",
          "Applies to browser-native `prefetch` / `prerender` candidates. It decides how many high-weight sites enter the site slot allocation stage."
        ),
        fields: createRuleFields("x", ruleOperatorOptions),
      },
      highWeightRankTab: {
        title: localize("ruleTabSiteTitle", "Real Preload group high-weight site count x"),
        description: localize(
          "ruleTabSiteDesc",
          "Applies to candidates that need hidden real background tabs, including cross-site new-tab preload and current-tab hard-swap cross-site candidates routed to hidden-tab."
        ),
        fields: createRuleFields("x", ruleOperatorOptions),
      },
      googleBookmarkRank: {
        title: localize("ruleGoogleBookmarkRankTitle", "Google search bookmark preload rank x"),
        description: localize(
          "ruleGoogleBookmarkRankDesc",
          "Only applies on Google search pages. When enabled, Chrome bookmarks are kept as independent persistent preload targets by this rank rule."
        ),
        fields: createRuleFields("x", ruleOperatorOptions),
      },
    };
  }

  globalThis.ZeroLatencySettingsSchemaRuleCards = {
    createRuleFields,
    createRuleCardSchema,
  };
})();
