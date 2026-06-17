function recordAiInterestSkipDiagnostic(predictionContext) {
  recordAiPredictionDiagnostic("prediction.ai.interest.skip", {
    enabled: predictionContext.aiPredictionSettings.enabled === true,
    configured: predictionContext.settings?.preloading?.effectiveAiPredictionConfigured === true,
    hasProvider: typeof predictionContext.aiProvider?.invokeConfiguredAiProvider === "function",
    hasModel: Boolean(predictionContext.aiPredictionSettings.modelId),
    hasKeywordTools: Boolean(predictionContext.aiKeywordTools),
    hasGraph: Boolean(predictionContext.graph),
  });
}

function recordAiInterestResultDiagnostic(
  aiPredictionSettings,
  interestKeywords,
  openPages,
  recentForegroundPages,
  historyPagePool
) {
  recordAiPredictionDiagnostic("prediction.ai.interest.result", {
    providerId: aiPredictionSettings.providerId || "",
    modelId: aiPredictionSettings.modelId || "",
    interestKeywordCount: Array.isArray(interestKeywords) ? interestKeywords.length : 0,
    openPageCount: openPages.length,
    recentForegroundPageCount: Array.isArray(recentForegroundPages)
      ? recentForegroundPages.length
      : 0,
    historyPageCount: Array.isArray(historyPagePool?.urls) ? historyPagePool.urls.length : 0,
  });
}

function recordAiInterestErrorDiagnostic(aiPredictionSettings, error) {
  recordAiPredictionDiagnostic("prediction.ai.interest.error", {
    providerId: aiPredictionSettings.providerId || "",
    modelId: aiPredictionSettings.modelId || "",
    error: error instanceof Error ? error.message : String(error),
  });
}

function recordAiPredictionDiagnostic(eventName, payload) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  globalThis.ZeroLatencyDiagnostics?.record?.(eventName, payload);
}
