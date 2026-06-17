(function () {
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

  function normalizePreloadSafetyUrl(rawUrl) {
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

  globalThis.ZeroLatencyPreloadSafetyNormalize = {
    normalizeCandidateSafety,
    normalizePreloadSafetyUrl,
    normalizeOptionalText,
    normalizeStringList,
    normalizeReasonToken,
    normalizeThreatVerdict,
  };
})();
