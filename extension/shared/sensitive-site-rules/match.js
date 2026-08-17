(function () {
  const constants = globalThis.ZeroLatencySensitiveSiteRuleConstants;
  const urlApi = globalThis.ZeroLatencySensitiveSiteRuleUrl;

  // 只按主机名后缀判定。v1 还有主机名 label 精确/子串、路径段、以及对
  // anchorText + nearbyText 的文本提示三套判据，全部因误判率过高被删除
  // （理由与实测数据见 constants.js 顶部）。
  //
  // `options` 现在只用 `baseUrl`；`anchorText` / `nearbyText` / `titleAttr` /
  // `ariaLabel` 已不再被读取。调用方**不需要**再为此读取 innerText ——
  // 那正是内容脚本 hover 路径上强制布局的来源，现已从根上消除。
  function inspectSensitiveSiteUrl(rawUrl, options = {}) {
    const parsedUrl = urlApi.normalizeSensitiveSiteUrl(rawUrl, options?.baseUrl || "");

    if (!parsedUrl) {
      return buildSensitiveSiteDecision([]);
    }

    return buildSensitiveSiteDecision(inspectHostSuffixes(parsedUrl.hostname));
  }

  function inspectHostSuffixes(hostname) {
    const matches = [];

    for (const [category, suffixes] of Object.entries(
      constants.HOST_SUFFIXES_BY_CATEGORY
    )) {
      for (const suffix of suffixes) {
        if (urlApi.isHostSuffixMatch(hostname, suffix)) {
          matches.push({
            category,
            reason: `sensitive-site-${category}`,
            field: "host-suffix",
            value: suffix,
          });
          break;
        }
      }
    }

    return matches;
  }

  function buildSensitiveSiteDecision(matches) {
    const normalizedMatches = Array.isArray(matches)
      ? matches.filter((match) => match?.category && match?.reason).slice(0, 12)
      : [];
    const categories = [
      ...new Set(normalizedMatches.map((match) => String(match.category || ""))),
    ].filter(Boolean);
    const reasons = [
      ...new Set(normalizedMatches.map((match) => String(match.reason || ""))),
    ].filter(Boolean);

    return {
      blocked: reasons.length > 0,
      reason: reasons[0] || "",
      reasons,
      categories,
      evidence:
        reasons.length > 0
          ? {
              libraryVersion: constants.SENSITIVE_SITE_LIBRARY_VERSION,
              matches: normalizedMatches,
            }
          : null,
    };
  }

  globalThis.ZeroLatencySensitiveSiteRuleMatch = {
    inspectSensitiveSiteUrl,
    buildSensitiveSiteDecision,
  };
})();
