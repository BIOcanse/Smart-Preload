(function () {
  const {
    normalizeReasonToken,
  } = globalThis.ZeroLatencyPreloadSafetyNormalize;

  function inspectDangerousSiteSignals(safety) {
    const reasons = [];

    if (safety.dangerousSite === true) {
      reasons.push("dangerous-site-verdict");
    }

    for (const threatType of safety.threatTypes || []) {
      const reasonToken = normalizeReasonToken(threatType);

      if (reasonToken) {
        reasons.push(`dangerous-site-${reasonToken}`);
      }
    }

    return [...new Set(reasons)];
  }

  function inspectLocalThreatUrl(url) {
    const decision = globalThis.ZeroLatencyLocalThreatDatabase?.inspectUrl?.(url);

    if (!decision?.blocked) {
      return {
        reasons: [],
        evidence: null,
      };
    }

    return {
      reasons: Array.isArray(decision.reasons) ? decision.reasons : [decision.reason],
      evidence: decision.evidence || null,
    };
  }

  function buildDangerousSiteEvidence(safety, localThreatEvidence = null) {
    if (localThreatEvidence) {
      return localThreatEvidence;
    }

    if (
      safety.dangerousSite !== true &&
      !safety.dangerousSiteReason &&
      !safety.threatSource &&
      (!Array.isArray(safety.threatTypes) || safety.threatTypes.length === 0)
    ) {
      return null;
    }

    return {
      verdict: safety.dangerousSite === true ? "unsafe" : "",
      reason: safety.dangerousSiteReason || "",
      source: safety.threatSource || "",
      threatTypes: Array.isArray(safety.threatTypes) ? safety.threatTypes.slice(0, 8) : [],
    };
  }

  globalThis.ZeroLatencyPreloadSafetyDangerousSite = {
    inspectDangerousSiteSignals,
    inspectLocalThreatUrl,
    buildDangerousSiteEvidence,
  };
})();
