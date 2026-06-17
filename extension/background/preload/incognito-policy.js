(function () {
  const incognitoMatch = globalThis.ZeroLatencyPreloadIncognitoMatch;
  const sourceWindow = globalThis.ZeroLatencyPreloadIncognitoSourceWindow;
  const cleanup = globalThis.ZeroLatencyPreloadIncognitoCleanup;

  globalThis.ZeroLatencyPreloadIncognitoPolicy = {
    isIncognitoPreloadExclusionEnabled:
      incognitoMatch.isIncognitoPreloadExclusionEnabled,
    shouldExcludeIncognitoPreloadSource:
      incognitoMatch.shouldExcludeIncognitoPreloadSource,
    resolveSourceTargetIncognitoMatch:
      incognitoMatch.resolveSourceTargetIncognitoMatch,
    resolvePreloadWindowSourceContext:
      sourceWindow.resolvePreloadWindowSourceContext,
    clearExcludedIncognitoPreloadState:
      cleanup.clearExcludedIncognitoPreloadState,
    removeSchedulerDataForSourceTab:
      cleanup.removeSchedulerDataForSourceTab,
  };
})();
