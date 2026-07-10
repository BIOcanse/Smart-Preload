(function () {
  const {
    normalizeThreatUrl,
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
  } = globalThis.ZeroLatencyThreatDatabaseFingerprint;
  const {
    initializeLibrary,
    findThreatSourceMatch,
    getLibraryMetadata,
  } = globalThis.ZeroLatencyThreatDatabaseSources;

  function inspectUrl(rawUrl) {
    const normalizedUrl = normalizeThreatUrl(rawUrl);

    if (!normalizedUrl) {
      return {
        blocked: false,
        reason: "",
        reasons: [],
        evidence: null,
      };
    }

    const match = findThreatSourceMatch(normalizedUrl);

    if (!match) {
      return {
        blocked: false,
        reason: "",
        reasons: [],
        evidence: null,
      };
    }

    const threatTypes = Array.isArray(match.source?.threatTypes)
      ? match.source.threatTypes.filter(Boolean).slice(0, 8)
      : [];
    const reasons = [
      "dangerous-site-local-threat-library",
      match.scope === "host-subtree" ? "dangerous-site-local-host-subtree" : "",
      ...threatTypes.map((threatType) => {
        const token = normalizeReasonToken(threatType);
        return token ? `dangerous-site-${token}` : "";
      }),
    ].filter(Boolean);

    return {
      blocked: true,
      reason: reasons[0] || "dangerous-site-local-threat-library",
      reasons: [...new Set(reasons)],
      evidence: {
        verdict: "unsafe",
        reason: "local-threat-library-match",
        source: match.source?.id || "local-threat-library",
        sourceName: match.source?.name || "",
        matchScope: match.scope || "exact-url",
        generatedAt: getLibraryMetadata().generatedAt,
        threatTypes,
      },
    };
  }

  function normalizeReasonToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48);
  }

  globalThis.ZeroLatencyLocalThreatDatabase = {
    initialize: initializeLibrary,
    inspectUrl,
    getLibraryMetadata,
    normalizeThreatUrl,
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
  };
})();
