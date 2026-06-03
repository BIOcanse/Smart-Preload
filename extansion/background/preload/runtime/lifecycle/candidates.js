const PRELOAD_CANDIDATE_COLLECTION_MESSAGE_TIMEOUT_MS = 750;

async function requestPreloadCandidateRefreshForOpenTabs() {
  const preloadState = await loadPreloadState();
  const runtimeSettings = getEffectiveExtensionSettings();
  const incognitoPolicy = globalThis.ZeroLatencyPreloadIncognitoPolicy;
  const tabs = await chrome.tabs.query({
    windowType: "normal",
  });
  const cleanup = await incognitoPolicy?.clearExcludedIncognitoPreloadState?.(
    preloadState,
    runtimeSettings,
    {
      tabs,
      reason: "open-tabs-refresh",
    }
  );

  if (cleanup?.mutated === true) {
    await savePreloadState(cleanup.preloadState);
  }

  for (const tab of tabs) {
    if (
      !tab.id ||
      incognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(tab, runtimeSettings) === true ||
      !isTrackableAndAllowedUrl(tab.url || "") ||
      isPreloadTab(preloadState, tab.id)
    ) {
      continue;
    }

    try {
      await sendPreloadCandidateCollectionMessage(tab.id, "open-tabs");
    } catch (error) {
      // Some pages may not have an active content script or may reject messaging.
      scheduleIndependentBackgroundPreloadCandidateRefreshForTab(
        tab,
        "open-tabs-message-failed",
        error
      );
    }
  }
}

async function requestPreloadCandidateRefreshForTab(tabId) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    return;
  }

  const preloadState = await loadPreloadState();
  const tab = await getTabMaybe(normalizedTabId);
  const runtimeSettings = getEffectiveExtensionSettings();
  const incognitoPolicy = globalThis.ZeroLatencyPreloadIncognitoPolicy;

  if (
    !tab?.id ||
    incognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(tab, runtimeSettings) === true ||
    !isTrackableAndAllowedUrl(tab.url || "") ||
    isPreloadTab(preloadState, tab.id)
  ) {
    if (incognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(tab, runtimeSettings) === true) {
      const cleanup = await incognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        runtimeSettings,
        {
          tabs: [tab],
          reason: "single-tab-refresh",
        }
      );

      if (cleanup.mutated) {
        await savePreloadState(cleanup.preloadState);
      }
    }
    return;
  }

  try {
    await sendPreloadCandidateCollectionMessage(tab.id, "single-tab");
  } catch (error) {
    // Some pages may not have an active content script or may reject messaging.
    scheduleIndependentBackgroundPreloadCandidateRefreshForTab(
      tab,
      "single-tab-message-failed",
      error
    );
  }
}

async function sendPreloadCandidateCollectionMessage(tabId, reason) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    throw new Error("invalid-tab-id");
  }

  const result = await Promise.race([
    chrome.tabs
      .sendMessage(normalizedTabId, {
        type: "preload:collect-candidates",
      })
      .then(
        () => ({ ok: true }),
        (error) => ({
          ok: false,
          error,
        })
      ),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: false,
          timedOut: true,
          error: new Error("preload collect-candidates message timed out"),
        });
      }, PRELOAD_CANDIDATE_COLLECTION_MESSAGE_TIMEOUT_MS);
    }),
  ]);

  if (result?.ok === true) {
    return;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.collect-message.failed", {
    tabId: normalizedTabId,
    reason,
    timedOut: result?.timedOut === true,
    error:
      result?.error instanceof Error
        ? result.error.message
        : String(result?.error || "unknown"),
  });
  throw result?.error ?? new Error("preload collect-candidates message failed");
}

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

  return (
    typeof isGoogleSearchPageForBookmarkPreload === "function" &&
    isGoogleSearchPageForBookmarkPreload(tab.url)
  );
}
