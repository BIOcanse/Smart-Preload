(function () {
  async function handleForegroundPageDigest(message, sender) {
    if (await isExtensionServicePaused()) {
      return { ok: true, skipped: true, reason: "service-paused" };
    }

    const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
    const sourceTab = sender?.tab;
    const pageUrl = normalizePageUrlForIndex(message?.pageUrl || sourceTab?.url || "");

    if (!sourceTab?.id || !pageUrl || !isTrackableAndAllowedUrl(pageUrl)) {
      return { ok: true, skipped: true };
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return { ok: true, skipped: true };
    }

    const currentWindow = await getWindowMaybe(sourceTab.windowId);

    if (currentWindow?.focused !== true || sourceTab.active !== true) {
      return { ok: true, skipped: true };
    }

    const trackingState = await loadTrackingState();
    const title = typeof message?.title === "string" ? message.title : "";
    const textDigest = typeof message?.textDigest === "string" ? message.textDigest : "";
    const contentFingerprint =
      typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "";
    const nodeId = buildNodeSeed(pageUrl).nodeId;
    const shouldRecordForegroundPage = shouldRefreshForegroundPageRecord(
      trackingState.graph,
      pageUrl,
      contentFingerprint,
      title,
      textDigest
    );
    const nextTrackingState = shouldRecordForegroundPage
      ? await queueMutation(async () => {
          const latestTrackingState = await loadTrackingState();
          const refreshedTrackingState = await applyTrackingEvent(latestTrackingState, {
            type: "record-foreground-page",
            tabId: String(sourceTab.id),
            windowId: String(sourceTab.windowId ?? -1),
            nodeId,
            pageUrl,
            title,
            textDigest,
            contentFingerprint,
            occurredAt: new Date().toISOString(),
            activatedAt: new Date().toISOString(),
            wasPreloadedBeforeForeground:
              findPreloadEntryByTabId(preloadState, sourceTab.id) !== null,
          });
          await saveTrackingState(refreshedTrackingState);
          return refreshedTrackingState;
        })
      : trackingState;

    const settings = getEffectiveExtensionSettings();
    const aiProvider = globalThis.ZeroLatencyAiProviders;
    const aiEnabled =
      settings.preloading.aiPrediction.enabled === true &&
      settings.preloading.effectiveAiPredictionConfigured === true &&
      typeof aiProvider?.invokeConfiguredAiProvider === "function";

    if (!aiEnabled) {
      return { ok: true, generatedKeywords: false };
    }

    const currentKeywordEntry =
      nextTrackingState.graph.pageKeywordStore?.[pageUrl] ??
      (await queryTrackingGraph(nextTrackingState, {
        type: "get-page-keywords",
        pageUrl,
      }));

    if (
      currentKeywordEntry &&
      currentKeywordEntry.contentFingerprint === contentFingerprint &&
      !isKeywordEntryExpired(currentKeywordEntry)
    ) {
      return { ok: true, generatedKeywords: false };
    }

    let normalizedKeywordResult;

    try {
      const generatedKeywords = await aiProvider.invokeConfiguredAiProvider(
        settings,
        aiKeywordTools.buildPageKeywordPrompt({
          pageUrl,
          title: typeof message?.title === "string" ? message.title : "",
          textDigest: typeof message?.textDigest === "string" ? message.textDigest : "",
          contentFingerprint,
        }),
        { responseFormat: "json" }
      );
      normalizedKeywordResult = aiKeywordTools.parseAiKeywordInferenceResponse(
        generatedKeywords?.output_text
      );
    } catch (error) {
      console.error("AI page keyword inference failed.", error);
      return { ok: true, generatedKeywords: false };
    }
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    await queueMutation(async () => {
      const latestTrackingState = await loadTrackingState();
      const latestKeywordEntry =
        latestTrackingState.graph.pageKeywordStore?.[pageUrl] ??
        (await queryTrackingGraph(latestTrackingState, {
          type: "get-page-keywords",
          pageUrl,
        }));

      if (
        latestKeywordEntry &&
        latestKeywordEntry.contentFingerprint === contentFingerprint &&
        !isKeywordEntryExpired(latestKeywordEntry)
      ) {
        return latestTrackingState;
      }

      const finalTrackingState = await applyTrackingEvent(latestTrackingState, {
        type: "upsert-page-keywords",
        pageUrl,
        siteNodeId: nodeId,
        title,
        keywords: normalizedKeywordResult.keywords,
        pageType: normalizedKeywordResult.pageType,
        generatedAt,
        expiresAt,
        modelId: settings.preloading.aiPrediction.modelId,
        contentFingerprint,
      });
      await saveTrackingState(finalTrackingState);
      return finalTrackingState;
    });
    return { ok: true, generatedKeywords: true };
  }

  function shouldRefreshForegroundPageRecord(
    graph,
    pageUrl,
    contentFingerprint,
    title,
    textDigest
  ) {
    const mostRecentForegroundPage = Array.isArray(graph?.recentForegroundPages)
      ? graph.recentForegroundPages[0]
      : null;

    if (!mostRecentForegroundPage || mostRecentForegroundPage.pageUrl !== pageUrl) {
      return true;
    }

    return (
      String(mostRecentForegroundPage.contentFingerprint || "") !== String(contentFingerprint || "") ||
      String(mostRecentForegroundPage.title || "") !== String(title || "") ||
      String(mostRecentForegroundPage.textDigest || "") !== String(textDigest || "")
    );
  }

  function isKeywordEntryExpired(pageKeywordEntry) {
    if (typeof pageKeywordEntry?.expiresAt !== "string") {
      return true;
    }

    const expiresAt = Date.parse(pageKeywordEntry.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= Date.now();
  }

  globalThis.ZeroLatencyLearningForegroundPages = {
    handleForegroundPageDigest,
    isKeywordEntryExpired,
    shouldRefreshForegroundPageRecord,
  };
})();
