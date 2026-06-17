(function () {
  const {
    resolveForegroundPageDigestContext,
  } = globalThis.ZeroLatencyLearningForegroundPageContext;
  const {
    recordForegroundPageIfNeeded,
    shouldRefreshForegroundPageRecord,
  } = globalThis.ZeroLatencyLearningForegroundPageRecord;
  const {
    shouldGenerateForegroundPageKeywords,
    getForegroundPageKeywordEntry,
    shouldRefreshPageKeywordEntry,
    generateForegroundPageKeywords,
    saveForegroundPageKeywordsIfNeeded,
    isKeywordEntryExpired,
  } = globalThis.ZeroLatencyLearningForegroundPageKeywords;

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

  globalThis.ZeroLatencyLearningForegroundPages = {
    handleForegroundPageDigest,
    isKeywordEntryExpired,
    shouldRefreshForegroundPageRecord,
  };
})();
