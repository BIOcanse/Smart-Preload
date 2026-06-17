async function resolveInteractionPreloadSourceContext(message, sender) {
  if (await isExtensionServicePaused()) {
    return { ok: false, reason: "service-paused" };
  }

  const sourceTab = sender?.tab ?? null;
  const sourcePageUrl =
    typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";

  if (!sourceTab?.id || !sourceTab.windowId) {
    return { ok: false, reason: "missing-source-tab" };
  }

  if (!sourcePageUrl || !isTrackableAndAllowedUrl(sourcePageUrl)) {
    return { ok: false, reason: "invalid-source-url" };
  }

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (sourceWindow?.type !== "normal") {
    return { ok: false, reason: "invalid-source-window" };
  }

  const settings = getEffectiveExtensionSettings();

  if (settings.preloading?.interactionPreloadEnabled === false) {
    return { ok: false, reason: "interaction-preload-disabled" };
  }

  const sourceIncognitoTab = {
    ...sourceTab,
    incognito: sourceTab.incognito === true || sourceWindow.incognito === true,
  };

  if (
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      sourceIncognitoTab,
      settings
    )
  ) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        settings,
        {
          tabs: [sourceIncognitoTab],
          reason: "interaction-preload",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    return { ok: false, reason: "incognito-excluded" };
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
      sourceTab,
      settings
    )
  ) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
        preloadState,
        settings,
        {
          tabs: [sourceTab],
          reason: "interaction-preload",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    return { ok: false, reason: "proxy-skip" };
  }

  if (
    globalThis.ZeroLatencyPreloadSensitiveSitePolicy?.shouldSkipSensitivePreloadSource?.(
      sourcePageUrl,
      settings
    )
  ) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadSensitiveSitePolicy.clearSensitivePreloadState(
        preloadState,
        settings,
        {
          tabs: [sourceTab],
          reason: "interaction-preload",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    return { ok: false, reason: "sensitive-site-skip" };
  }

  return {
    ok: true,
    sourceTab,
    sourcePageUrl,
    settings,
  };
}
