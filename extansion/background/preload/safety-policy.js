(function () {
  const DOWNLOAD_EXTENSION_SET = new Set([
    "7z",
    "apk",
    "appx",
    "bat",
    "bin",
    "bz2",
    "cmd",
    "crx",
    "deb",
    "dmg",
    "exe",
    "gz",
    "img",
    "iso",
    "jar",
    "msi",
    "msix",
    "pkg",
    "ps1",
    "rar",
    "reg",
    "rpm",
    "sh",
    "tar",
    "tgz",
    "torrent",
    "xpi",
    "xz",
    "zip",
  ]);
  const DOWNLOAD_MIME_HINTS = [
    "application/octet-stream",
    "application/x-msdownload",
    "application/x-msi",
    "application/zip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/gzip",
    "application/vnd.android.package-archive",
    "application/x-apple-diskimage",
  ];
  const DOWNLOAD_PATH_TOKENS = new Set([
    "attachment",
    "attachments",
    "download",
    "downloads",
    "downloadfile",
    "download-file",
    "export",
    "exports",
  ]);
  const SIDE_EFFECT_PATH_TOKENS = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "logout",
    "log-out",
    "remove",
    "signout",
    "sign-out",
    "unsubscribe",
  ]);
  const DOWNLOAD_QUERY_KEYS = new Set([
    "attachment",
    "content-disposition",
    "dl",
    "download",
    "export",
    "file",
    "filename",
    "response-content-disposition",
  ]);
  const SIDE_EFFECT_QUERY_VALUES = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "download",
    "export",
    "logout",
    "remove",
    "signout",
    "unsubscribe",
  ]);

  function inspectPreloadCandidate(candidate, fallbackUrl = "") {
    const url = normalizeUrl(candidate?.url || fallbackUrl);
    const safety = normalizeCandidateSafety(candidate);
    const sideEffectReasons = [];
    const dangerousSiteReasons = [];

    if (!url) {
      return buildDecision({
        sideEffectReasons: ["invalid-url"],
        dangerousSiteReasons,
      });
    }

    if (safety.downloadAttribute === true) {
      sideEffectReasons.push("download-attribute");
    }

    if (hasDangerousMimeType(safety.typeAttr)) {
      sideEffectReasons.push("download-mime-type");
    }

    const urlReasons = inspectUrl(url);
    sideEffectReasons.push(...urlReasons);
    dangerousSiteReasons.push(...inspectDangerousSiteSignals(safety));
    const localThreatDecision = inspectLocalThreatUrl(url);
    dangerousSiteReasons.push(...localThreatDecision.reasons);

    return buildDecision({
      sideEffectReasons,
      dangerousSiteReasons,
      dangerousSiteEvidence: buildDangerousSiteEvidence(safety, localThreatDecision.evidence),
    });
  }

  function shouldSkipPreloadCandidate(candidate, fallbackUrl = "") {
    return inspectPreloadCandidate(candidate, fallbackUrl).skipPreload === true;
  }

  function shouldBlockRealPreload(candidate, fallbackUrl = "") {
    return inspectPreloadCandidate(candidate, fallbackUrl).realPreloadBlocked === true;
  }

  function attachPreloadSafety(candidate, fallbackUrl = "") {
    const decision = inspectPreloadCandidate(candidate, fallbackUrl);

    return {
      ...candidate,
      realPreloadSafety: decision,
    };
  }

  function normalizeCandidateSafety(candidate) {
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
      dangerousSite:
        rawSafety.dangerousSite === true ||
        rawSafety.unsafeSite === true ||
        rawSafety.blockedByThreatList === true ||
        normalizeThreatVerdict(rawSafety.threatVerdict) === "unsafe" ||
        normalizeThreatVerdict(rawSafety.threatVerdict) === "dangerous" ||
        normalizeThreatVerdict(candidate?.threatVerdict) === "unsafe" ||
        normalizeThreatVerdict(candidate?.threatVerdict) === "dangerous" ||
        candidate?.dangerousSite === true ||
        candidate?.unsafeSite === true,
      dangerousSiteReason:
        normalizeOptionalText(rawSafety.dangerousSiteReason) ||
        normalizeOptionalText(rawSafety.threatReason) ||
        normalizeOptionalText(candidate?.dangerousSiteReason) ||
        normalizeOptionalText(candidate?.threatReason),
      threatSource:
        normalizeOptionalText(rawSafety.threatSource) ||
        normalizeOptionalText(rawSafety.verdictSource) ||
        normalizeOptionalText(candidate?.threatSource) ||
        normalizeOptionalText(candidate?.verdictSource),
      threatTypes: normalizeStringList(
        rawSafety.threatTypes ??
          rawSafety.threatType ??
          candidate?.threatTypes ??
          candidate?.threatType
      ),
    };
  }

  function inspectUrl(rawUrl) {
    const reasons = [];

    try {
      const url = new URL(rawUrl);
      const pathSegments = url.pathname
        .split("/")
        .map((segment) => safeDecodeURIComponent(segment).trim().toLowerCase())
        .filter(Boolean);
      const extension = getPathExtension(pathSegments[pathSegments.length - 1] || "");

      if (extension && DOWNLOAD_EXTENSION_SET.has(extension)) {
        reasons.push("download-file-extension");
      }

      if (pathSegments.some((segment) => DOWNLOAD_PATH_TOKENS.has(segment))) {
        reasons.push("download-url-path");
      }

      if (pathSegments.some((segment) => SIDE_EFFECT_PATH_TOKENS.has(segment))) {
        reasons.push("side-effect-url-path");
      }

      for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = String(key || "").trim().toLowerCase();
        const normalizedValue = String(value || "").trim().toLowerCase();

        if (DOWNLOAD_QUERY_KEYS.has(normalizedKey)) {
          reasons.push("download-query");
        }

        if (
          SIDE_EFFECT_QUERY_VALUES.has(normalizedValue) ||
          (normalizedKey === "action" && SIDE_EFFECT_QUERY_VALUES.has(normalizedValue)) ||
          (normalizedKey === "method" && SIDE_EFFECT_QUERY_VALUES.has(normalizedValue))
        ) {
          reasons.push("side-effect-query");
        }

        if (normalizedValue.includes("attachment")) {
          reasons.push("download-query-attachment");
        }
      }
    } catch (_error) {
      reasons.push("invalid-url");
    }

    return [...new Set(reasons)];
  }

  function hasDangerousMimeType(typeAttr) {
    const normalizedType = String(typeAttr || "").trim().toLowerCase();

    return Boolean(
      normalizedType &&
        DOWNLOAD_MIME_HINTS.some((mimeHint) => normalizedType.includes(mimeHint))
    );
  }

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

  function getPathExtension(fileName) {
    const normalizedName = String(fileName || "").split(/[?#]/u)[0];
    const dotIndex = normalizedName.lastIndexOf(".");

    if (dotIndex <= 0 || dotIndex === normalizedName.length - 1) {
      return "";
    }

    return normalizedName.slice(dotIndex + 1).toLowerCase();
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return String(value || "");
    }
  }

  function normalizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }

      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function normalizeOptionalText(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function normalizeStringList(value) {
    const rawItems = Array.isArray(value) ? value : value ? [value] : [];

    return [
      ...new Set(
        rawItems
          .map((item) => normalizeOptionalText(item))
          .filter(Boolean)
          .slice(0, 8)
      ),
    ];
  }

  function normalizeReasonToken(value) {
    return normalizeOptionalText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48);
  }

  function normalizeThreatVerdict(value) {
    return normalizeOptionalText(value).toLowerCase();
  }

  function buildDecision({
    sideEffectReasons,
    dangerousSiteReasons,
    dangerousSiteEvidence = null,
  }) {
    const uniqueSideEffectReasons = [
      ...new Set((Array.isArray(sideEffectReasons) ? sideEffectReasons : []).filter(Boolean)),
    ];
    const uniqueDangerousSiteReasons = [
      ...new Set((Array.isArray(dangerousSiteReasons) ? dangerousSiteReasons : []).filter(Boolean)),
    ];
    const uniqueReasons = [...new Set([...uniqueSideEffectReasons, ...uniqueDangerousSiteReasons])];
    const sideEffectBlocked = uniqueSideEffectReasons.length > 0;
    const dangerousSiteBlocked = uniqueDangerousSiteReasons.length > 0;
    const blocked = uniqueReasons.length > 0;

    return {
      enabled: true,
      locked: true,
      skipPreload: blocked,
      realPreloadBlocked: blocked,
      sideEffectBlocked,
      dangerousSiteBlocked,
      reason: uniqueReasons[0] || "",
      reasons: uniqueReasons,
      sideEffectReasons: uniqueSideEffectReasons,
      dangerousSiteReasons: uniqueDangerousSiteReasons,
      dangerousSiteEvidence,
    };
  }

  globalThis.ZeroLatencyPreloadSafetyPolicy = {
    inspectPreloadCandidate,
    shouldSkipPreloadCandidate,
    shouldBlockRealPreload,
    attachPreloadSafety,
  };
})();
