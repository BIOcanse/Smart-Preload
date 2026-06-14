async function resolvePreloadCandidateRegistrationContext(message, sender) {
  if (await isExtensionServicePaused()) {
    return {
      ok: false,
      response: {
        ok: true,
        preloadedCount: 0,
        skipped: true,
        reason: "service-paused",
      },
    };
  }

  const sourceTab = sender?.tab;

  if (!sourceTab?.id || !sourceTab.windowId) {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  const sourcePageUrl = message?.pageUrl || sourceTab.url || "";

  if (globalThis.isKnownPreloadContext?.(sourceTab.id, sourceTab.windowId) === true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.skip-preload-context", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      pageUrl: sourcePageUrl,
    });
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  if (!isTrackableAndAllowedUrl(sourcePageUrl)) {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  const runtimeSettings = getEffectiveExtensionSettings();

  if (!runtimeSettings.preloading.enabled) {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (!sourceWindow || sourceWindow.type !== "normal") {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  if (
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      {
        ...sourceTab,
        incognito: sourceTab.incognito === true || sourceWindow.incognito === true,
      },
      runtimeSettings
    )
  ) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        runtimeSettings,
        {
          tabs: [{ ...sourceTab, incognito: true }],
          reason: "candidate-registration",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.skip-incognito-source", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      pageUrl: sourcePageUrl,
    });
    return {
      ok: false,
      response: {
        ok: true,
        preloadedCount: 0,
        skipped: true,
        reason: "incognito-excluded",
      },
    };
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
      sourceTab,
      runtimeSettings
    )
  ) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
        preloadState,
        runtimeSettings,
        {
          tabs: [sourceTab],
          reason: "candidate-registration",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.skip-proxy-source", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      pageUrl: sourcePageUrl,
    });
    return {
      ok: false,
      response: {
        ok: true,
        preloadedCount: 0,
        skipped: true,
        reason: "proxy-skip",
      },
    };
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, sourceTab.id)) {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  const featureSupport = globalThis.ZeroLatencySupport?.getBackgroundFeatureSupport?.() ?? {
    hiddenTabPreload: false,
  };

  return {
    ok: true,
    sourceTab,
    sourceWindow,
    sourcePageUrl,
    runtimeSettings,
    featureSupport,
  };
}
