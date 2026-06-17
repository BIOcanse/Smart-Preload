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
    buildPreloadSafetyDecision,
  } = globalThis.ZeroLatencyPreloadSafetyDecision;

  function inspectPreloadCandidate(candidate, fallbackUrl = "") {
    const url = normalizePreloadSafetyUrl(candidate?.url || fallbackUrl);
    const safety = normalizeCandidateSafety(candidate);
    const sideEffectReasons = [];
    const dangerousSiteReasons = [];

    if (!url) {
      return buildPreloadSafetyDecision({
        sideEffectReasons: ["invalid-url"],
        dangerousSiteReasons,
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

    return buildPreloadSafetyDecision({
      sideEffectReasons,
      dangerousSiteReasons,
      dangerousSiteEvidence: buildDangerousSiteEvidence(safety, localThreatDecision.evidence),
    });
  }

  function shouldSkipPreloadCandidate(candidate, fallbackUrl = "") {
    return inspectPreloadCandidate(candidate, fallbackUrl).skipPreload === true;
  }

  function shouldBlockRealPreload(candidate, fallbackUrl = "") {
    return inspectPreloadCandidate(candidate, fallbackUrl).realPreloadBlocked === true;
  }

  function attachPreloadSafety(candidate, fallbackUrl = "") {
    const decision = inspectPreloadCandidate(candidate, fallbackUrl);

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
