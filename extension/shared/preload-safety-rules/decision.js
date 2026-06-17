(function () {
  function normalizeSideEffectDecision(sideEffectReasons) {
    const uniqueReasons = [...new Set((sideEffectReasons || []).filter(Boolean))];

    return {
      skipPreload: uniqueReasons.length > 0,
      sideEffectBlocked: uniqueReasons.length > 0,
      reason: uniqueReasons[0] || "",
      reasons: uniqueReasons,
      sideEffectReasons: uniqueReasons,
    };
  }

  globalThis.ZeroLatencyPreloadSafetyRuleDecision = {
    normalizeSideEffectDecision,
  };
})();
