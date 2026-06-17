(function () {
  const constants = globalThis.ZeroLatencySensitiveSiteRuleConstants;
  const urlApi = globalThis.ZeroLatencySensitiveSiteRuleUrl;

  function inspectSensitiveSiteUrl(rawUrl, options = {}) {
    const parsedUrl = urlApi.normalizeSensitiveSiteUrl(rawUrl, options?.baseUrl || "");

    if (!parsedUrl) {
      return buildSensitiveSiteDecision([]);
    }

    const matches = [
      ...inspectHostSuffixes(parsedUrl.hostname),
      ...inspectHostLabels(parsedUrl.hostname),
      ...inspectPathTokens(parsedUrl.pathname),
      ...inspectTextHints(options),
    ];

    return buildSensitiveSiteDecision(matches);
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

  function inspectHostLabels(hostname) {
    const labels = urlApi.splitSensitiveHostLabels(hostname);
    const matches = [];

    for (const [category, tokens] of Object.entries(
      constants.HOST_LABEL_TOKENS_BY_CATEGORY
    )) {
      const tokenSet = new Set(tokens);

      if (labels.some((label) => tokenSet.has(label))) {
        matches.push({
          category,
          reason: `sensitive-site-${category}`,
          field: "host-label",
          value: "",
        });
      }
    }

    for (const [category, substrings] of Object.entries(
      constants.HOST_LABEL_SUBSTRINGS_BY_CATEGORY
    )) {
      if (matches.some((match) => match.category === category)) {
        continue;
      }

      const matchedSubstring = labels.find((label) =>
        substrings.some((substring) => label.includes(substring))
      );

      if (matchedSubstring) {
        matches.push({
          category,
          reason: `sensitive-site-${category}`,
          field: "host-label-substring",
          value: matchedSubstring,
        });
      }
    }

    return matches;
  }

  function inspectPathTokens(pathname) {
    const pathTokens = new Set(urlApi.splitSensitivePathTokens(pathname));
    const matches = [];

    for (const [category, tokens] of Object.entries(constants.PATH_TOKENS_BY_CATEGORY)) {
      const matchedToken = tokens.find((token) => pathTokens.has(token));

      if (matchedToken) {
        matches.push({
          category,
          reason: `sensitive-site-${category}`,
          field: "path-token",
          value: matchedToken,
        });
      }
    }

    return matches;
  }

  function inspectTextHints(options) {
    const text = urlApi.normalizeSensitiveText(
      [options?.anchorText, options?.nearbyText, options?.titleAttr, options?.ariaLabel]
        .filter(Boolean)
        .join(" ")
    );

    if (!text) {
      return [];
    }

    const matches = [];

    for (const [category, hints] of Object.entries(constants.TEXT_HINTS_BY_CATEGORY)) {
      const matchedHint = hints.find((hint) =>
        text.includes(String(hint || "").toLowerCase())
      );

      if (matchedHint) {
        matches.push({
          category,
          reason: `sensitive-site-${category}`,
          field: "text-hint",
          value: matchedHint,
        });
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
