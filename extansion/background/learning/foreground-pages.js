(function () {
  async function handleForegroundPageDigest(message, sender) {
    const context = await resolveForegroundPageDigestContext(message, sender);

    if (context.response) {
      return context.response;
    }

    const nextTrackingState = await recordForegroundPageIfNeeded(context);
    const settings = getEffectiveExtensionSettings();
    const aiProvider = globalThis.ZeroLatencyAiProviders;

    if (!shouldGenerateForegroundPageKeywords(settings, aiProvider)) {
      return { ok: true, generatedKeywords: false };
    }

    const currentKeywordEntry = await getForegroundPageKeywordEntry(
      nextTrackingState,
      context.pageUrl
    );

    if (!shouldRefreshPageKeywordEntry(currentKeywordEntry, context.contentFingerprint)) {
      return { ok: true, generatedKeywords: false };
    }

    const normalizedKeywordResult = await generateForegroundPageKeywords({
      aiProvider,
      settings,
      context,
    });

    if (!normalizedKeywordResult) {
      return { ok: true, generatedKeywords: false };
    }

    await saveForegroundPageKeywordsIfNeeded({
      context,
      settings,
      normalizedKeywordResult,
    });
    return { ok: true, generatedKeywords: true };
  }

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

  async function recordForegroundPageIfNeeded(context) {
    const trackingState = await loadTrackingState();
    const shouldRecordForegroundPage = shouldRefreshForegroundPageRecord(
      trackingState.graph,
      context.pageUrl,
      context.contentFingerprint,
      context.title,
      context.textDigest
    );

    if (!shouldRecordForegroundPage) {
      return trackingState;
    }

    return queueMutation(async () => {
      const latestTrackingState = await loadTrackingState();
      const refreshedTrackingState = await applyTrackingEvent(latestTrackingState, {
        type: "record-foreground-page",
        tabId: String(context.sourceTab.id),
        windowId: String(context.sourceTab.windowId ?? -1),
        nodeId: context.nodeId,
        pageUrl: context.pageUrl,
        title: context.title,
        textDigest: context.textDigest,
        contentFingerprint: context.contentFingerprint,
        occurredAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        wasPreloadedBeforeForeground:
          findPreloadEntryByTabId(context.preloadState, context.sourceTab.id) !== null,
      });
      await saveTrackingState(refreshedTrackingState);
      return refreshedTrackingState;
    });
  }

  function shouldGenerateForegroundPageKeywords(settings, aiProvider) {
    return (
      settings.preloading.aiPrediction.enabled === true &&
      settings.preloading.effectiveAiPredictionConfigured === true &&
      typeof aiProvider?.invokeConfiguredAiProvider === "function" &&
      Boolean(globalThis.ZeroLatencyAiKeywords)
    );
  }

  async function getForegroundPageKeywordEntry(trackingState, pageUrl) {
    return (
      trackingState.graph.pageKeywordStore?.[pageUrl] ??
      (await queryTrackingGraph(trackingState, {
        type: "get-page-keywords",
        pageUrl,
      }))
    );
  }

  function shouldRefreshPageKeywordEntry(currentKeywordEntry, contentFingerprint) {
    return !(
      currentKeywordEntry &&
      currentKeywordEntry.contentFingerprint === contentFingerprint &&
      !isKeywordEntryExpired(currentKeywordEntry)
    );
  }

  async function generateForegroundPageKeywords({ aiProvider, settings, context }) {
    const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;

    try {
      const generatedKeywords = await aiProvider.invokeConfiguredAiProvider(
        settings,
        aiKeywordTools.buildPageKeywordPrompt({
          pageUrl: context.pageUrl,
          title: context.title,
          textDigest: context.textDigest,
          contentFingerprint: context.contentFingerprint,
        }),
        { responseFormat: "json" }
      );
      return aiKeywordTools.parseAiKeywordInferenceResponse(generatedKeywords?.output_text);
    } catch (error) {
      console.error("AI page keyword inference failed.", error);
      return null;
    }
  }

  async function saveForegroundPageKeywordsIfNeeded({
    context,
    settings,
    normalizedKeywordResult,
  }) {
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    await queueMutation(async () => {
      const latestTrackingState = await loadTrackingState();
      const latestKeywordEntry =
        latestTrackingState.graph.pageKeywordStore?.[context.pageUrl] ??
        (await queryTrackingGraph(latestTrackingState, {
          type: "get-page-keywords",
          pageUrl: context.pageUrl,
        }));

      if (!shouldRefreshPageKeywordEntry(latestKeywordEntry, context.contentFingerprint)) {
        return latestTrackingState;
      }

      const finalTrackingState = await applyTrackingEvent(latestTrackingState, {
        type: "upsert-page-keywords",
        pageUrl: context.pageUrl,
        siteNodeId: context.nodeId,
        title: context.title,
        keywords: normalizedKeywordResult.keywords,
        pageType: normalizedKeywordResult.pageType,
        generatedAt,
        expiresAt,
        modelId: settings.preloading.aiPrediction.modelId,
        contentFingerprint: context.contentFingerprint,
      });
      await saveTrackingState(finalTrackingState);
      return finalTrackingState;
    });
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
