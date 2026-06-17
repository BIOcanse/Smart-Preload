(function () {
  function buildPreloadSafetyDecision({
    sideEffectReasons,
    dangerousSiteReasons,
    sensitiveSiteReasons,
    dangerousSiteEvidence = null,
    sensitiveSiteEvidence = null,
  }) {
    const uniqueSideEffectReasons = [
      ...new Set((Array.isArray(sideEffectReasons) ? sideEffectReasons : []).filter(Boolean)),
    ];
    const uniqueDangerousSiteReasons = [
      ...new Set((Array.isArray(dangerousSiteReasons) ? dangerousSiteReasons : []).filter(Boolean)),
    ];
    const uniqueSensitiveSiteReasons = [
      ...new Set((Array.isArray(sensitiveSiteReasons) ? sensitiveSiteReasons : []).filter(Boolean)),
    ];
    const uniqueReasons = [
      ...new Set([
        ...uniqueSideEffectReasons,
        ...uniqueDangerousSiteReasons,
        ...uniqueSensitiveSiteReasons,
      ]),
    ];
    const sideEffectBlocked = uniqueSideEffectReasons.length > 0;
    const dangerousSiteBlocked = uniqueDangerousSiteReasons.length > 0;
    const sensitiveSiteBlocked = uniqueSensitiveSiteReasons.length > 0;
    const blocked = uniqueReasons.length > 0;

    return {
      enabled: true,
      locked: true,
      skipPreload: blocked,
      realPreloadBlocked: blocked,
      sideEffectBlocked,
      dangerousSiteBlocked,
      sensitiveSiteBlocked,
      reason: uniqueReasons[0] || "",
      reasons: uniqueReasons,
      sideEffectReasons: uniqueSideEffectReasons,
      dangerousSiteReasons: uniqueDangerousSiteReasons,
      sensitiveSiteReasons: uniqueSensitiveSiteReasons,
      dangerousSiteEvidence,
      sensitiveSiteEvidence,
    };
  }

  globalThis.ZeroLatencyPreloadSafetyDecision = {
    buildPreloadSafetyDecision,
  };
})();
