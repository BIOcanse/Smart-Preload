(function () {
  function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function mergeSettings(base, override) {
    if (!isPlainObject(base)) {
      return cloneSettings(override);
    }

    const result = cloneSettings(base);

    if (!isPlainObject(override)) {
      return result;
    }

    for (const [key, value] of Object.entries(override)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = mergeSettings(result[key], value);
        continue;
      }

      result[key] = cloneSettings(value);
    }

    return result;
  }

  function clamp(value, min, max, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numericValue)));
  }

  function wildcardMatch(value, pattern) {
    const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
    return regex.test(String(value || "").toLowerCase());
  }

  function escapeRegex(value) {
    return String(value).replace(/[|\\{}()[\]^$+?.*]/g, "\\$&");
  }

  function parseUrlForRuleMatch(value) {
    try {
      const parsedUrl = new URL(String(value || ""));
      return {
        href: parsedUrl.href.toLowerCase(),
        host: parsedUrl.host.toLowerCase(),
        hostname: parsedUrl.hostname.toLowerCase(),
        pathname: parsedUrl.pathname.toLowerCase(),
        search: parsedUrl.search.toLowerCase(),
        hash: parsedUrl.hash.toLowerCase(),
      };
    } catch (_error) {
      return null;
    }
  }

  globalThis.ZeroLatencySettingsUtils = {
    cloneSettings,
    isPlainObject,
    mergeSettings,
    clamp,
    wildcardMatch,
    escapeRegex,
    parseUrlForRuleMatch,
  };
})();
