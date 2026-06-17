function invokeAiInterestKeywordInference({
  aiKeywordTools,
  aiProvider,
  settings,
  aiPredictionSettings,
  currentPage,
  openPages,
  recentForegroundPageRecords,
  historyPageRecords,
}) {
  return aiProvider
    .invokeConfiguredAiProvider(
      settings,
      aiKeywordTools.buildContextKeywordPrompt({
        currentPage,
        openPages,
        recentForegroundPages: recentForegroundPageRecords,
        historyPagePool: historyPageRecords,
      }),
      { responseFormat: "json" }
    )
    .then((result) => aiKeywordTools.parseAiKeywordInferenceResponse(result?.output_text))
    .then((result) => (Array.isArray(result?.keywords) ? result.keywords : []))
    .catch((error) => {
      console.error("AI interest keyword inference failed.", error);
      recordAiInterestErrorDiagnostic(aiPredictionSettings, error);
      return [];
    });
}
