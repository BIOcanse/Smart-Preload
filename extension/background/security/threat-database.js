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
    getLibraryLoadStatus,
    isLibraryReady,
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

    // 库还没就绪时 **fail closed**。
    //
    // inspectUrl 是同步的，而调用方（safety-policy.js:46）不等 bootstrap 完成，所以在
    // service worker 冷启动的头几毫秒里它会先被调用。此前这种情况与「库已加载但没命中」
    // 返回同一个 blocked: false —— 也就是每次 SW 冷启动都有一小段窗口，全部危险站点检查
    // 静默放行，而且无人知晓。
    //
    // 内容脚本那侧的同类检查本来就是 fail-closed（scripts/navigation/shared/safety.js:32-41
    // 在规则库缺失时返回 skipPreload: true），两边策略此前不一致。
    //
    // 代价可以量化：库是 2.25 MB 的打包内资源，实测 JSON.parse 约 5-7 ms，加上读取共约
    // 10 ms 量级。也就是每次 SW 冷启动暂停预加载约 10 ms —— 相对 SW 启动本身可忽略。
    if (!isLibraryReady()) {
      const status = getLibraryLoadStatus();

      return {
        blocked: true,
        unavailable: true,
        reason: "dangerous-site-local-threat-library-unavailable",
        reasons: ["dangerous-site-local-threat-library-unavailable"],
        evidence: {
          verdict: "unknown",
          reason: "local-threat-library-unavailable",
          source: "local-threat-library",
          libraryState: status.state,
          libraryError: status.error,
        },
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
    getLibraryLoadStatus,
    isLibraryReady,
    normalizeThreatUrl,
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
  };
})();
