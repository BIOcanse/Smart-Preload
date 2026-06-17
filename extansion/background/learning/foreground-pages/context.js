(function () {
  async function resolveForegroundPageDigestContext(message, sender) {
    if (await isExtensionServicePaused()) {
      return { response: { ok: true, skipped: true, reason: "service-paused" } };
    }

    const sourceTab = sender?.tab;
    const pageUrl = normalizePageUrlForIndex(message?.pageUrl || sourceTab?.url || "");

    if (!sourceTab?.id || !pageUrl || !isTrackableAndAllowedUrl(pageUrl)) {
      return { response: { ok: true, skipped: true } };
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return { response: { ok: true, skipped: true } };
    }

    const currentWindow = await getWindowMaybe(sourceTab.windowId);

    if (currentWindow?.focused !== true || sourceTab.active !== true) {
      return { response: { ok: true, skipped: true } };
    }

    return {
      response: null,
      sourceTab,
      preloadState,
      pageUrl,
      title: typeof message?.title === "string" ? message.title : "",
      textDigest: typeof message?.textDigest === "string" ? message.textDigest : "",
      contentFingerprint:
        typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
      nodeId: buildNodeSeed(pageUrl).nodeId,
    };
  }

  globalThis.ZeroLatencyLearningForegroundPageContext = {
    resolveForegroundPageDigestContext,
  };
})();
