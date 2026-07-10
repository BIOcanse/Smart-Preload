(function () {
  const THREAT_LIBRARY_PATH = "background/security/local-threat-library.json";
  const {
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
    buildHostSuffixes,
  } = globalThis.ZeroLatencyThreatDatabaseFingerprint;
  let cachedSources = null;
  let libraryLoadPromise = null;

  async function initializeLibrary(options = {}) {
    if (globalThis.ZeroLatencyLocalThreatLibrary) {
      return globalThis.ZeroLatencyLocalThreatLibrary;
    }

    if (libraryLoadPromise) {
      return libraryLoadPromise;
    }

    libraryLoadPromise = (async () => {
      const fetchImpl = options.fetchImpl || globalThis.fetch;
      const libraryUrl =
        options.libraryUrl ||
        globalThis.chrome?.runtime?.getURL?.(THREAT_LIBRARY_PATH) ||
        THREAT_LIBRARY_PATH;

      if (typeof fetchImpl !== "function") {
        throw new Error("Threat library fetch is unavailable.");
      }

      const response = await fetchImpl(libraryUrl, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Threat library load failed: HTTP ${response.status}`);
      }

      const library = await response.json();

      if (!library || typeof library !== "object") {
        throw new Error("Threat library payload is invalid.");
      }

      globalThis.ZeroLatencyLocalThreatLibrary = library;
      cachedSources = null;
      return library;
    })().catch((error) => {
      libraryLoadPromise = null;
      throw error;
    });

    return libraryLoadPromise;
  }

  function findThreatSourceMatch(normalizedUrl) {
    const fingerprint = fingerprintThreatUrl(normalizedUrl);
    return findUrlSourceMatch(fingerprint) || findHostSourceMatch(normalizedUrl);
  }

  function findUrlSourceMatch(fingerprint) {
    for (const sourceEntry of getSourceEntries()) {
      if (containsSortedFingerprint(sourceEntry.urlFingerprints, fingerprint)) {
        return { source: sourceEntry.source, scope: "exact-url" };
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

    const hostFingerprints = buildHostSuffixes(hostname).map(fingerprintThreatHost);

    for (const hostFingerprint of hostFingerprints) {
      for (const sourceEntry of getSourceEntries()) {
        if (containsSortedFingerprint(sourceEntry.hostFingerprints, hostFingerprint)) {
          return { source: sourceEntry.source, scope: "host-subtree" };
        }
      }
    }

    return null;
  }

  function getSourceEntries() {
    if (cachedSources) {
      return cachedSources;
    }

    const library = getLibraryMetadata();
    const urlFingerprints = library.urlFingerprintsBySource || {};
    const hostFingerprints = library.hostFingerprintsBySource || {};
    const sourceById = Object.fromEntries(
      (Array.isArray(library.sources) ? library.sources : []).map((source) => [
        source?.id || "",
        source,
      ])
    );
    const sourceIds = [...new Set([...Object.keys(urlFingerprints), ...Object.keys(hostFingerprints)])];
    cachedSources = sourceIds.map((sourceId) => ({
      source: sourceById[sourceId] || { id: sourceId },
      urlFingerprints: normalizeSortedFingerprints(urlFingerprints[sourceId]),
      hostFingerprints: normalizeSortedFingerprints(hostFingerprints[sourceId]),
    }));
    return cachedSources;
  }

  function normalizeSortedFingerprints(value) {
    return Array.isArray(value) ? value : [];
  }

  function containsSortedFingerprint(fingerprints, target) {
    let low = 0;
    let high = fingerprints.length - 1;

    while (low <= high) {
      const middle = (low + high) >>> 1;
      const value = String(fingerprints[middle]);

      if (value === target) {
        return true;
      }

      if (value < target) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return false;
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
    initializeLibrary,
    findThreatSourceMatch,
    getLibraryMetadata,
    containsSortedFingerprint,
  };
})();
