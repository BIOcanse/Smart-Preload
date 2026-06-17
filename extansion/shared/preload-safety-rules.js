(function () {
  const candidateApi = globalThis.ZeroLatencyPreloadSafetyRuleCandidate;
  const urlApi = globalThis.ZeroLatencyPreloadSafetyRuleUrl;

  globalThis.ZeroLatencyPreloadSafetyRules = {
    inspectSideEffectCandidateSafety:
      candidateApi.inspectSideEffectCandidateSafety,
    inspectSideEffectUrl: urlApi.inspectSideEffectUrl,
    hasDangerousMimeType: candidateApi.hasDangerousMimeType,
    normalizeCandidateSideEffectSafety:
      candidateApi.normalizeCandidateSideEffectSafety,
  };
})();
