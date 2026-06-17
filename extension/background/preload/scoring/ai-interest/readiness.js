function resolveAiInterestPredictionContext(context = {}) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const aiProvider = globalThis.ZeroLatencyAiProviders;
  const settings = context?.settings ?? null;
  const aiPredictionSettings = settings?.preloading?.aiPrediction ?? {};
  const graph = context?.graph ?? null;
  const ready =
    aiPredictionSettings.enabled === true &&
    settings?.preloading?.effectiveAiPredictionConfigured === true &&
    typeof aiProvider?.invokeConfiguredAiProvider === "function" &&
    Boolean(aiPredictionSettings.modelId) &&
    Boolean(aiKeywordTools) &&
    Boolean(graph);

  return {
    aiKeywordTools,
    aiProvider,
    settings,
    aiPredictionSettings,
    graph,
    ready,
  };
}

function buildEmptyAiInterestContext() {
  return {
    interestKeywords: [],
    historyPagePool: null,
    recentForegroundPages: [],
    currentPage: null,
    openPages: [],
  };
}
