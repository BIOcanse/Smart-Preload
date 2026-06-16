(function () {
  const FNV_64_OFFSET = 0xcbf29ce484222325n;
  const FNV_64_PRIME = 0x100000001b3n;
  const FNV_64_MASK = 0xffffffffffffffffn;
  let cachedSourceSets = null;

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

    const fingerprint = fingerprintThreatUrl(normalizedUrl);
    const urlMatch = findUrlSourceMatch(fingerprint);
    const hostMatch = urlMatch ? null : findHostSourceMatch(normalizedUrl);
    const match = urlMatch || hostMatch;

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

  function findUrlSourceMatch(fingerprint) {
    const sourceSets = getSourceSets();

    for (const sourceSet of sourceSets) {
      if (sourceSet.urlFingerprints.has(fingerprint)) {
        return {
          source: sourceSet.source,
          scope: "exact-url",
        };
      }
    }

    return null;
  }

  function findHostSourceMatch(normalizedUrl) {
    let hostname = "";

    try {
      hostname = normalizeThreatHostname(new URL(normalizedUrl).hostname);
    } catch (_error) {
      return null;
    }

    if (!hostname) {
      return null;
    }

    const sourceSets = getSourceSets();
    const hostFingerprints = buildHostSuffixes(hostname).map((host) =>
      fingerprintThreatHost(host)
    );

    for (const hostFingerprint of hostFingerprints) {
      for (const sourceSet of sourceSets) {
        if (sourceSet.hostFingerprints.has(hostFingerprint)) {
          return {
            source: sourceSet.source,
            scope: "host-subtree",
          };
        }
      }
    }

    return null;
  }

  function getSourceSets() {
    if (cachedSourceSets) {
      return cachedSourceSets;
    }

    const library = getLibraryMetadata();
    const fingerprintsBySource =
      library && typeof library.urlFingerprintsBySource === "object"
        ? library.urlFingerprintsBySource
        : {};
    const hostFingerprintsBySource =
      library && typeof library.hostFingerprintsBySource === "object"
        ? library.hostFingerprintsBySource
        : {};
    const sourcesById = new Map(
      (Array.isArray(library.sources) ? library.sources : []).map((source) => [
        source?.id || "",
        source,
      ])
    );

    const sourceIds = [
      ...new Set([
        ...Object.keys(fingerprintsBySource),
        ...Object.keys(hostFingerprintsBySource),
      ]),
    ];

    cachedSourceSets = sourceIds
      .map((sourceId) => ({
        source: sourcesById.get(sourceId) || { id: sourceId },
        urlFingerprints: new Set(
          Array.isArray(fingerprintsBySource[sourceId]) ? fingerprintsBySource[sourceId] : []
        ),
        hostFingerprints: new Set(
          Array.isArray(hostFingerprintsBySource[sourceId])
            ? hostFingerprintsBySource[sourceId]
            : []
        ),
      }))
      .filter((entry) => entry.urlFingerprints.size > 0 || entry.hostFingerprints.size > 0);

    return cachedSourceSets;
  }

  function getLibraryMetadata() {
    return globalThis.ZeroLatencyLocalThreatLibrary || {
      version: 1,
      generatedAt: "",
      sources: [],
      urlFingerprintsBySource: {},
      hostFingerprintsBySource: {},
    };
  }

  function normalizeThreatUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }

      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function fingerprintThreatUrl(normalizedUrl) {
    return fingerprintString(String(normalizedUrl || ""));
  }

  function normalizeThreatHostname(rawHostname) {
    return String(rawHostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\[/u, "")
      .replace(/\]$/u, "");
  }

  function fingerprintThreatHost(normalizedHostname) {
    return fingerprintString(normalizeThreatHostname(normalizedHostname));
  }

  function fingerprintString(value) {
    const normalizedValue = String(value || "");
    let hash = FNV_64_OFFSET;

    for (let index = 0; index < normalizedValue.length; index += 1) {
      hash ^= BigInt(normalizedValue.charCodeAt(index));
      hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
    }

    return `${hash.toString(16).padStart(16, "0")}:${normalizedValue.length}`;
  }

  function buildHostSuffixes(hostname) {
    const normalizedHostname = normalizeThreatHostname(hostname);

    if (!normalizedHostname || normalizedHostname.includes(":")) {
      return normalizedHostname ? [normalizedHostname] : [];
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalizedHostname)) {
      return [normalizedHostname];
    }

    const parts = normalizedHostname.split(".").filter(Boolean);
    const suffixes = [];

    for (let index = 0; index < parts.length - 1; index += 1) {
      suffixes.push(parts.slice(index).join("."));
    }

    return suffixes;
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
    inspectUrl,
    getLibraryMetadata,
    normalizeThreatUrl,
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
  };
})();
