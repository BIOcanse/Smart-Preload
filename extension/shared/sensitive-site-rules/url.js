(function () {
  function normalizeSensitiveSiteUrl(rawUrl, baseUrl = "") {
    try {
      const parsedUrl = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return null;
      }

      return parsedUrl;
    } catch (_error) {
      return null;
    }
  }

  function normalizeSensitiveHostname(hostname) {
    return String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\[/u, "")
      .replace(/\]$/u, "");
  }

  function splitSensitiveHostLabels(hostname) {
    return normalizeSensitiveHostname(hostname)
      .split(/[.\-_]+/u)
      .map((label) => label.trim())
      .filter(Boolean);
  }

  function splitSensitivePathTokens(pathname) {
    return String(pathname || "")
      .split("/")
      .flatMap((segment) => safeDecodeURIComponent(segment).split(/[\s._-]+/u))
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeSensitiveText(value) {
    return String(value || "")
      .replace(/\s+/gu, " ")
      .trim()
      .toLowerCase()
      .slice(0, 1200);
  }

  function isHostSuffixMatch(hostname, suffix) {
    const normalizedHostname = normalizeSensitiveHostname(hostname);
    const normalizedSuffix = normalizeSensitiveHostname(suffix);

    return (
      Boolean(normalizedHostname && normalizedSuffix) &&
      (normalizedHostname === normalizedSuffix ||
        normalizedHostname.endsWith(`.${normalizedSuffix}`))
    );
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  globalThis.ZeroLatencySensitiveSiteRuleUrl = {
    normalizeSensitiveSiteUrl,
    normalizeSensitiveHostname,
    splitSensitiveHostLabels,
    splitSensitivePathTokens,
    normalizeSensitiveText,
    isHostSuffixMatch,
  };
})();
