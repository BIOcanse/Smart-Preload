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

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (!sourceWindow || sourceWindow.type !== "normal") {
    return {
      ok: false,
      response: { ok: true, preloadedCount: 0, skipped: true },
    };
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, sourceTab.id)) {
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
