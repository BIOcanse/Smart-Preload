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

        if (constants.SIDE_EFFECT_QUERY_VALUES.has(normalizedValue)) {
          reasons.push("side-effect-query");
        }

        // 一次性凭据类 key：此前**只看 value 不看 key**，于是 `?token=…`、`?unsubscribe=1`
        // 这类会被预加载消耗掉的链接全部放行。
        if (
          constants.SIDE_EFFECT_QUERY_KEYS.has(normalizedKey) ||
          constants.SIDE_EFFECT_QUERY_KEY_SUFFIXES.some((suffix) =>
            normalizedKey.endsWith(suffix)
          )
        ) {
          reasons.push("side-effect-query-credential");
        }

        // 动作型 key 用更宽的动词表。此前这里的 action / method 两个子句是上面那个
        // 「值命中即拦截」子句的严格子集，恒不可达。
        if (
          constants.SIDE_EFFECT_ACTION_QUERY_KEYS.has(normalizedKey) &&
          constants.SIDE_EFFECT_ACTION_VALUES.has(normalizedValue)
        ) {
          reasons.push("side-effect-action-query");
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
