(function () {
  const {
    mergeSettings,
    wildcardMatch,
    parseUrlForRuleMatch,
  } = globalThis.ZeroLatencySettingsUtils;
  const { PROXY_SKIP_MODE_VALUES } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizeProxySkipMode(value, fallback = DEFAULT_SETTINGS.preloading.proxySkip.mode) {
    return PROXY_SKIP_MODE_VALUES.includes(value) ? value : fallback;
  }

  function normalizeProxySkipSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.proxySkip, value);

    return {
      enabled: mergedValue.enabled === true,
      mode: normalizeProxySkipMode(mergedValue.mode),
      rules: normalizeProxySkipRules(mergedValue.rules),
    };
  }

  function normalizeProxySkipRules(value) {
    const rawRules = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\r?\n/)
        : [];
    const rules = [];
    const seen = new Set();

    for (const rawRule of rawRules) {
      const normalizedRule = normalizeProxySkipRuleText(rawRule);

      if (!normalizedRule || normalizedRule.startsWith("#")) {
        continue;
      }

      const key = normalizedRule.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      rules.push(normalizedRule);

      if (rules.length >= 200) {
        break;
      }
    }

    return rules;
  }

  function normalizeProxySkipRuleText(value) {
    return typeof value === "string" ? value.trim().slice(0, 512) : "";
  }

  function shouldSkipProxyRuleUrl(url, settings) {
    const proxySkipSettings = normalizeProxySkipSettings(
      settings?.preloading?.proxySkip ?? settings?.proxySkip
    );

    if (proxySkipSettings.enabled !== true) {
      return false;
    }

    const matched = proxySkipSettings.rules.some((rule) =>
      doesProxySkipRuleMatchUrl(rule, url)
    );

    return proxySkipSettings.mode === "whitelist" ? !matched : matched;
  }

  function doesProxySkipRuleMatchUrl(rule, url) {
    const ruleText = normalizeProxySkipRuleText(rule);
    const parsedUrl = parseUrlForRuleMatch(url);

    if (!ruleText || !parsedUrl) {
      return false;
    }

    const normalizedRule = ruleText.toLowerCase();

    if (normalizedRule.includes("://") || normalizedRule.startsWith("*://")) {
      return wildcardMatch(parsedUrl.href, normalizedRule);
    }

    if (normalizedRule.includes("/")) {
      const hostAndPath = `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      return wildcardMatch(hostAndPath, normalizedRule);
    }

    return doesProxySkipHostRuleMatch(normalizedRule, parsedUrl);
  }

  function doesProxySkipHostRuleMatch(ruleText, parsedUrl) {
    const hostRule = ruleText.replace(/^\*\./, "").replace(/^\./, "");

    if (!hostRule) {
      return false;
    }

    if (hostRule.includes("*")) {
      return wildcardMatch(parsedUrl.hostname, hostRule) || wildcardMatch(parsedUrl.host, hostRule);
    }

    const compareValue = hostRule.includes(":") ? parsedUrl.host : parsedUrl.hostname;
    return compareValue === hostRule || compareValue.endsWith(`.${hostRule}`);
  }

  globalThis.ZeroLatencySettingsProxySkip = {
    normalizeProxySkipMode,
    normalizeProxySkipSettings,
    normalizeProxySkipRules,
    shouldSkipProxyRuleUrl,
    doesProxySkipRuleMatchUrl,
  };
})();
