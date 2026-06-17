(function () {
  const {
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
    buildHostSuffixes,
  } = globalThis.ZeroLatencyThreatDatabaseFingerprint;
  let cachedSourceSets = null;

  function findThreatSourceMatch(normalizedUrl) {
    const fingerprint = fingerprintThreatUrl(normalizedUrl);
    const urlMatch = findUrlSourceMatch(fingerprint);

    return urlMatch || findHostSourceMatch(normalizedUrl);
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

  globalThis.ZeroLatencyThreatDatabaseSources = {
    findThreatSourceMatch,
    getLibraryMetadata,
  };
})();
