function buildAiKeywordMatchResult({
  interestKeywords,
  candidate,
  targetPageKeywordEntry,
}) {
  const fieldEntries = buildCandidateSemanticFieldEntries(candidate, targetPageKeywordEntry);

  return buildKeywordMatchResultFromFieldEntries({
    interestKeywords,
    fieldEntries,
  });
}

function buildSiteAiKeywordMatchResult({
  interestKeywords,
  siteCandidates,
  targetPageKeywordsByUrl,
}) {
  const fieldEntries = buildSiteSemanticFieldEntries(siteCandidates, targetPageKeywordsByUrl);

  return buildKeywordMatchResultFromFieldEntries({
    interestKeywords,
    fieldEntries,
  });
}

globalThis.ZeroLatencyAiKeywords = {
  MAX_AI_KEYWORD_COUNT,
  KEYWORD_MATCH_MULTIPLIERS,
  buildPageKeywordPrompt,
  buildContextKeywordPrompt,
  buildHistoryPagePoolRecords,
  buildAiKeywordMatchResult,
  buildSiteAiKeywordMatchResult,
  parseAiKeywordInferenceResponse,
};
