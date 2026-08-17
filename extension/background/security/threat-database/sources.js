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
  // "pending" | "ready" | "failed"。inspectUrl 是同步的、且调用方不 await bootstrap，
  // 所以它必须能分辨「库还没到」和「库到了但没命中」——此前两者都返回 blocked: false。
  let libraryLoadState = "pending";
  let libraryLoadError = "";

  function getLibraryLoadStatus() {
    return {
      state: libraryLoadState,
      error: libraryLoadError,
      generatedAt: getLibraryMetadata().generatedAt || "",
      sourceIds: (getLibraryMetadata().sources || [])
        .map((source) => String(source?.id || ""))
        .filter(Boolean),
    };
  }

  // 就绪判据是「库对象在不在」，而不是「经由哪条路加载的」—— initializeLibrary 本来就把
  // 已存在的库直接当作有效（下面的提前返回），测试与其它注入路径也依赖这一点。
  // libraryLoadState 只用于诊断，区分「还没到」和「加载失败」。
  function isLibraryReady() {
    return Boolean(globalThis.ZeroLatencyLocalThreatLibrary);
  }

  async function initializeLibrary(options = {}) {
    if (globalThis.ZeroLatencyLocalThreatLibrary) {
      libraryLoadState = "ready";
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
      libraryLoadState = "ready";
      libraryLoadError = "";
      return library;
    })().catch((error) => {
      libraryLoadPromise = null;
      libraryLoadState = "failed";
      libraryLoadError = error instanceof Error ? error.message : String(error);
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
    getLibraryLoadStatus,
    isLibraryReady,
    containsSortedFingerprint,
  };
})();
