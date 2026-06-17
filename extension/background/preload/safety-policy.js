(function () {
  const {
    normalizeCandidateSafety,
    normalizePreloadSafetyUrl,
  } = globalThis.ZeroLatencyPreloadSafetyNormalize;
  const {
    inspectDangerousSiteSignals,
    inspectLocalThreatUrl,
    buildDangerousSiteEvidence,
  } = globalThis.ZeroLatencyPreloadSafetyDangerousSite;
  const {
    inspectSensitiveSiteSignals,
  } = globalThis.ZeroLatencyPreloadSafetySensitiveSite;
  const {
    buildPreloadSafetyDecision,
  } = globalThis.ZeroLatencyPreloadSafetyDecision;

  function inspectPreloadCandidate(candidate, fallbackUrl = "", settings = null) {
    const url = normalizePreloadSafetyUrl(candidate?.url || fallbackUrl);
    const safety = normalizeCandidateSafety(candidate);
    const sideEffectReasons = [];
    const dangerousSiteReasons = [];
    const sensitiveSiteReasons = [];
    let sensitiveSiteEvidence = null;

    if (!url) {
      return buildPreloadSafetyDecision({
        sideEffectReasons: ["invalid-url"],
        dangerousSiteReasons,
        sensitiveSiteReasons,
      });
    }

    const sideEffectDecision =
      globalThis.ZeroLatencyPreloadSafetyRules?.inspectSideEffectCandidateSafety?.(
        {
          url,
          preloadSafety: safety,
        },
        url
      ) ?? {
        sideEffectReasons: ["preload-safety-rules-unavailable"],
      };
    sideEffectReasons.push(...(sideEffectDecision.sideEffectReasons || []));
    dangerousSiteReasons.push(...inspectDangerousSiteSignals(safety));
    const localThreatDecision = inspectLocalThreatUrl(url);
    dangerousSiteReasons.push(...localThreatDecision.reasons);
    const sensitiveSiteDecision = inspectSensitiveSiteSignals(url, settings, candidate);
    sensitiveSiteReasons.push(...sensitiveSiteDecision.reasons);
    sensitiveSiteEvidence = sensitiveSiteDecision.evidence || null;

    return buildPreloadSafetyDecision({
      sideEffectReasons,
      dangerousSiteReasons,
      sensitiveSiteReasons,
      dangerousSiteEvidence: buildDangerousSiteEvidence(safety, localThreatDecision.evidence),
      sensitiveSiteEvidence,
    });
  }

  function shouldSkipPreloadCandidate(candidate, fallbackUrl = "", settings = null) {
    return inspectPreloadCandidate(candidate, fallbackUrl, settings).skipPreload === true;
  }

  function shouldBlockRealPreload(candidate, fallbackUrl = "", settings = null) {
    return inspectPreloadCandidate(candidate, fallbackUrl, settings).realPreloadBlocked === true;
  }

  function attachPreloadSafety(candidate, fallbackUrl = "", settings = null) {
    const decision = inspectPreloadCandidate(candidate, fallbackUrl, settings);

    return {
      ...candidate,
      realPreloadSafety: decision,
    };
  }

  globalThis.ZeroLatencyPreloadSafetyPolicy = {
    inspectPreloadCandidate,
    shouldSkipPreloadCandidate,
    shouldBlockRealPreload,
    attachPreloadSafety,
  };
})();
