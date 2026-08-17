(function () {
  // v2 只做主机名后缀匹配，所以这里只剩三个函数。
  // 随四套「按词猜」的判据一并删除的：splitSensitiveHostLabels（主机名 label 拆分）、
  // splitSensitivePathTokens（路径段拆分）、normalizeSensitiveText（文本提示归一化）、
  // safeDecodeURIComponent（只被路径拆分用到）。理由见 constants.js 顶部。
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

  // 完全相等，或以 `.` + 后缀结尾。后者的点号是关键：没有它，
  // `evil-icbc.com.cn` 会命中 `icbc.com.cn`。
  function isHostSuffixMatch(hostname, suffix) {
    const normalizedHostname = normalizeSensitiveHostname(hostname);
    const normalizedSuffix = normalizeSensitiveHostname(suffix);

    return (
      Boolean(normalizedHostname && normalizedSuffix) &&
      (normalizedHostname === normalizedSuffix ||
        normalizedHostname.endsWith(`.${normalizedSuffix}`))
    );
  }

  globalThis.ZeroLatencySensitiveSiteRuleUrl = {
    normalizeSensitiveSiteUrl,
    normalizeSensitiveHostname,
    isHostSuffixMatch,
  };
})();
