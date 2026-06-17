(function () {
  const constants = globalThis.ZeroLatencyPreloadSafetyRuleConstants;

  function inspectSideEffectUrl(rawUrl, options = {}) {
    const reasons = [];

    try {
      const baseUrl = typeof options?.baseUrl === "string" ? options.baseUrl : "";
      const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
      const pathSegments = url.pathname
        .split("/")
        .map((segment) => safeDecodeURIComponent(segment).trim().toLowerCase())
        .filter(Boolean);
      const extension = getPathExtension(pathSegments[pathSegments.length - 1] || "");

      if (extension && constants.DOWNLOAD_EXTENSION_SET.has(extension)) {
        reasons.push("download-file-extension");
      }

      if (pathSegments.some((segment) => constants.DOWNLOAD_PATH_TOKENS.has(segment))) {
        reasons.push("download-url-path");
      }

      if (pathSegments.some((segment) => constants.SIDE_EFFECT_PATH_TOKENS.has(segment))) {
        reasons.push("side-effect-url-path");
      }

      for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = String(key || "").trim().toLowerCase();
        const normalizedValue = String(value || "").trim().toLowerCase();

        if (constants.DOWNLOAD_QUERY_KEYS.has(normalizedKey)) {
          reasons.push("download-query");
        }

        if (
          constants.SIDE_EFFECT_QUERY_VALUES.has(normalizedValue) ||
          (normalizedKey === "action" &&
            constants.SIDE_EFFECT_QUERY_VALUES.has(normalizedValue)) ||
          (normalizedKey === "method" &&
            constants.SIDE_EFFECT_QUERY_VALUES.has(normalizedValue))
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

  globalThis.ZeroLatencyPreloadSafetyRuleUrl = {
    inspectSideEffectUrl,
    getPathExtension,
    safeDecodeURIComponent,
  };
})();
