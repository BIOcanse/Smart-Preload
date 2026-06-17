(function () {
  function inspectSensitiveSiteSignals(url, settings = null, candidate = null) {
    const decision =
      globalThis.ZeroLatencyPreloadSensitiveSitePolicy?.inspectSensitivePreloadUrl?.(
        url,
        settings,
        {
          anchorText: candidate?.anchorText || "",
          nearbyText: candidate?.nearbyText || "",
          titleAttr: candidate?.titleAttr || "",
          ariaLabel: candidate?.ariaLabel || "",
        }
      ) ?? {
        blocked: false,
        reasons: [],
        evidence: null,
      };

    return {
      reasons: Array.isArray(decision.reasons) ? decision.reasons : [decision.reason],
      evidence: decision.evidence || null,
    };
  }

  globalThis.ZeroLatencyPreloadSafetySensitiveSite = {
    inspectSensitiveSiteSignals,
  };
})();
