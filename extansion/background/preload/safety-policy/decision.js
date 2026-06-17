(function () {
  function buildPreloadSafetyDecision({
    sideEffectReasons,
    dangerousSiteReasons,
    dangerousSiteEvidence = null,
  }) {
    const uniqueSideEffectReasons = [
      ...new Set((Array.isArray(sideEffectReasons) ? sideEffectReasons : []).filter(Boolean)),
    ];
    const uniqueDangerousSiteReasons = [
      ...new Set((Array.isArray(dangerousSiteReasons) ? dangerousSiteReasons : []).filter(Boolean)),
    ];
    const uniqueReasons = [...new Set([...uniqueSideEffectReasons, ...uniqueDangerousSiteReasons])];
    const sideEffectBlocked = uniqueSideEffectReasons.length > 0;
    const dangerousSiteBlocked = uniqueDangerousSiteReasons.length > 0;
    const blocked = uniqueReasons.length > 0;

    return {
      enabled: true,
      locked: true,
      skipPreload: blocked,
      realPreloadBlocked: blocked,
      sideEffectBlocked,
      dangerousSiteBlocked,
      reason: uniqueReasons[0] || "",
      reasons: uniqueReasons,
      sideEffectReasons: uniqueSideEffectReasons,
      dangerousSiteReasons: uniqueDangerousSiteReasons,
      dangerousSiteEvidence,
    };
  }

  globalThis.ZeroLatencyPreloadSafetyDecision = {
    buildPreloadSafetyDecision,
  };
})();
