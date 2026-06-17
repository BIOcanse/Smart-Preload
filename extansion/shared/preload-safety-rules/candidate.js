(function () {
  const constants = globalThis.ZeroLatencyPreloadSafetyRuleConstants;
  const urlApi = globalThis.ZeroLatencyPreloadSafetyRuleUrl;
  const decisionApi = globalThis.ZeroLatencyPreloadSafetyRuleDecision;

  function inspectSideEffectCandidateSafety(candidate, fallbackUrl = "", baseUrl = "") {
    const safety = normalizeCandidateSideEffectSafety(candidate);
    const sideEffectReasons = [];

    if (safety.downloadAttribute === true) {
      sideEffectReasons.push("download-attribute");
    }

    if (hasDangerousMimeType(safety.typeAttr)) {
      sideEffectReasons.push("download-mime-type");
    }

    sideEffectReasons.push(
      ...urlApi.inspectSideEffectUrl(candidate?.url || fallbackUrl, {
        baseUrl,
      })
    );

    return decisionApi.normalizeSideEffectDecision(sideEffectReasons);
  }

  function normalizeCandidateSideEffectSafety(candidate) {
    const rawSafety =
      candidate?.preloadSafety ??
      candidate?.linkSafety ??
      candidate?.safety ??
      {};

    return {
      downloadAttribute:
        rawSafety.downloadAttribute === true ||
        rawSafety.hasDownloadAttribute === true ||
        candidate?.downloadAttribute === true,
      typeAttr: String(rawSafety.typeAttr || rawSafety.mimeType || candidate?.typeAttr || "")
        .trim()
        .toLowerCase(),
    };
  }

  function hasDangerousMimeType(typeAttr) {
    const normalizedType = String(typeAttr || "").trim().toLowerCase();

    return Boolean(
      normalizedType &&
        constants.DOWNLOAD_MIME_HINTS.some((mimeHint) => normalizedType.includes(mimeHint))
    );
  }

  globalThis.ZeroLatencyPreloadSafetyRuleCandidate = {
    inspectSideEffectCandidateSafety,
    normalizeCandidateSideEffectSafety,
    hasDangerousMimeType,
  };
})();
