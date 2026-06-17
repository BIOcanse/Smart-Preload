(function () {
  function isIncognitoPreloadExclusionEnabled(settings = null) {
    const runtimeSettings =
      settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);

    return runtimeSettings?.preloading?.excludeIncognitoWindows !== false;
  }

  function shouldExcludeIncognitoPreloadSource(tab, settings = null) {
    return tab?.incognito === true && isIncognitoPreloadExclusionEnabled(settings);
  }

  function resolveSourceTargetIncognitoMatch(sourceTab, targetTab, targetWindow) {
    const sourceIncognito = sourceTab?.incognito === true;
    const targetIncognito =
      targetTab?.incognito === true || targetWindow?.incognito === true;

    return {
      sourceIncognito,
      targetIncognito,
      matches: sourceIncognito === targetIncognito,
    };
  }

  globalThis.ZeroLatencyPreloadIncognitoMatch = {
    isIncognitoPreloadExclusionEnabled,
    shouldExcludeIncognitoPreloadSource,
    resolveSourceTargetIncognitoMatch,
  };
})();
