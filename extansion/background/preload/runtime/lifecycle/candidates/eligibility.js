async function clearPreloadCandidateRefreshExclusionsForOpenTabs(
  preloadState,
  runtimeSettings,
  tabs
) {
  const incognitoPolicy = globalThis.ZeroLatencyPreloadIncognitoPolicy;
  const proxySkipPolicy = globalThis.ZeroLatencyPreloadProxySkipPolicy;
  const incognitoCleanup = await incognitoPolicy?.clearExcludedIncognitoPreloadState?.(
    preloadState,
    runtimeSettings,
    {
      tabs,
      reason: "open-tabs-refresh",
    }
  );
  const proxyCleanup = await proxySkipPolicy?.clearProxySkippedPreloadState?.(
    incognitoCleanup?.preloadState ?? preloadState,
    runtimeSettings,
    {
      tabs,
      reason: "open-tabs-refresh",
    }
  );
  const nextPreloadState =
    proxyCleanup?.preloadState ?? incognitoCleanup?.preloadState ?? preloadState;

  return {
    preloadState: nextPreloadState,
    mutated: incognitoCleanup?.mutated === true || proxyCleanup?.mutated === true,
  };
}

async function clearPreloadCandidateRefreshExclusionsForTab(
  preloadState,
  tab,
  runtimeSettings
) {
  const incognitoPolicy = globalThis.ZeroLatencyPreloadIncognitoPolicy;
  const proxySkipPolicy = globalThis.ZeroLatencyPreloadProxySkipPolicy;
  let cleanupState = preloadState;
  let cleanupMutated = false;

  if (incognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(tab, runtimeSettings) === true) {
    const cleanup = await incognitoPolicy.clearExcludedIncognitoPreloadState(
      cleanupState,
      runtimeSettings,
      {
        tabs: [tab],
        reason: "single-tab-refresh",
      }
    );

    if (cleanup.mutated) {
      cleanupState = cleanup.preloadState;
      cleanupMutated = true;
    }
  }
  if (proxySkipPolicy?.shouldSkipProxyPreloadSource?.(tab, runtimeSettings) === true) {
    const cleanup = await proxySkipPolicy.clearProxySkippedPreloadState(
      cleanupState,
      runtimeSettings,
      {
        tabs: [tab],
        reason: "single-tab-refresh",
      }
    );

    if (cleanup.mutated) {
      cleanupState = cleanup.preloadState;
      cleanupMutated = true;
    }
  }

  return {
    preloadState: cleanupState,
    mutated: cleanupMutated,
  };
}

function shouldSkipPreloadCandidateRefreshForTab(tab, preloadState, runtimeSettings) {
  return (
    !tab?.id ||
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      tab,
      runtimeSettings
    ) === true ||
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
      tab,
      runtimeSettings
    ) === true ||
    !isTrackableAndAllowedUrl(tab.url || "") ||
    isPreloadTab(preloadState, tab.id)
  );
}
