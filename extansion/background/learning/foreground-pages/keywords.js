(function () {
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

  function isKeywordEntryExpired(pageKeywordEntry) {
    if (typeof pageKeywordEntry?.expiresAt !== "string") {
      return true;
    }

    const expiresAt = Date.parse(pageKeywordEntry.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt <= Date.now();
  }

  globalThis.ZeroLatencyLearningForegroundPageKeywords = {
    shouldGenerateForegroundPageKeywords,
    getForegroundPageKeywordEntry,
    shouldRefreshPageKeywordEntry,
    generateForegroundPageKeywords,
    saveForegroundPageKeywordsIfNeeded,
    isKeywordEntryExpired,
  };
})();
