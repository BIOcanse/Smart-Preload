function scheduleIndependentBackgroundPreloadCandidateRefreshForTab(tab, reason, cause) {
  void requestIndependentBackgroundPreloadCandidateRefreshForTab(tab, reason, cause).catch(
    (error) => {
      globalThis.ZeroLatencyDebugEvents?.record?.(
        "preload-candidates.background-independent-refresh.error",
        {
          tabId: tab?.id ?? null,
          windowId: tab?.windowId ?? null,
          pageUrl: tab?.url || "",
          reason,
          cause: cause instanceof Error ? cause.message : String(cause || ""),
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  );
}

async function requestIndependentBackgroundPreloadCandidateRefreshForTab(
  tab,
  reason,
  cause
) {
  if (!shouldRunIndependentBackgroundPreloadCandidateRefresh(tab)) {
    return;
  }

  if (typeof registerPreloadCandidates !== "function") {
    return;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.(
    "preload-candidates.background-independent-refresh",
    {
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      pageUrl: tab?.url || "",
      reason,
      cause: cause instanceof Error ? cause.message : String(cause || ""),
    }
  );

  await registerPreloadCandidates(
    {
      type: "preload:candidates",
      pageUrl: tab.url || "",
      pageTitle: tab.title || "",
      pageTextDigest: "",
      contentFingerprint: "",
      links: [],
      backgroundIndependentOnly: true,
    },
    { tab }
  );
}

function shouldRunIndependentBackgroundPreloadCandidateRefresh(tab) {
  if (!tab?.id || !tab.windowId || !tab.url) {
    return false;
  }

  if (
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      tab,
      getEffectiveExtensionSettings()
    ) === true
  ) {
    return false;
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
      tab,
      getEffectiveExtensionSettings()
    ) === true
  ) {
    return false;
  }

  return (
    typeof isGoogleSearchPageForBookmarkPreload === "function" &&
    isGoogleSearchPageForBookmarkPreload(tab.url)
  );
}
