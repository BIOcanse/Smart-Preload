async function getAiInterestKeywordsForPreloading(context = {}) {
  const predictionContext = resolveAiInterestPredictionContext(context);

  if (!predictionContext.ready) {
    recordAiInterestSkipDiagnostic(predictionContext);
    return buildEmptyAiInterestContext();
  }

  const { historyPagePool, recentForegroundPages, currentPage, openPages } =
    await globalThis.ZeroLatencyAiInterestContext.loadAiInterestPageContext(
      context,
      predictionContext.graph
    );
  const interestKeywords = await getAiInterestKeywords({
    settings: predictionContext.settings,
    currentPage,
    openPages,
    historyPagePool,
    recentForegroundPages,
  });

  recordAiInterestResultDiagnostic(
    predictionContext.aiPredictionSettings,
    interestKeywords,
    openPages,
    recentForegroundPages,
    historyPagePool
  );

  return {
    interestKeywords,
    historyPagePool,
    recentForegroundPages,
    currentPage,
    openPages,
  };
}

async function getAiInterestKeywords({
  settings,
  currentPage,
  openPages,
  historyPagePool,
  recentForegroundPages,
}) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const aiProvider = globalThis.ZeroLatencyAiProviders;
  const aiPredictionSettings = settings?.preloading?.aiPrediction ?? {};
  const historyPageRecords = aiKeywordTools.buildHistoryPagePoolRecords(historyPagePool);
  const recentForegroundPageRecords =
    globalThis.ZeroLatencyAiInterestContext.normalizeRecentForegroundPagePromptRecords(
      recentForegroundPages
    );
  const cacheKey = buildAiInterestKeywordCacheKey({
    aiPredictionSettings,
    currentPage,
    openPages,
    recentForegroundPageRecords,
    historyPageRecords,
  });
  const cachedPromise = getCachedAiInterestKeywordPromise(cacheKey);

  if (cachedPromise) {
    return cachedPromise;
  }

  const inferencePromise = invokeAiInterestKeywordInference({
    aiKeywordTools,
    aiProvider,
    settings,
    aiPredictionSettings,
    currentPage,
    openPages,
    recentForegroundPageRecords,
    historyPageRecords,
  });

  setCachedAiInterestKeywordPromise(cacheKey, inferencePromise);
  return inferencePromise;
}
