(function () {
  const matchApi = globalThis.ZeroLatencySensitiveSiteRuleMatch;

  globalThis.ZeroLatencySensitiveSiteRules = {
    inspectUrl: matchApi.inspectSensitiveSiteUrl,
    buildDecision: matchApi.buildSensitiveSiteDecision,
  };
})();
