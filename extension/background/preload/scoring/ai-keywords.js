async function appendAiKeywordScoreMultipliers(candidatePool, context) {
  if (!Array.isArray(candidatePool) || candidatePool.length === 0) {
    return [];
  }

  const aiKeywordMultipliersByUrl = await buildAiKeywordMultipliersByUrl(candidatePool, context);

  return candidatePool.map((candidate) => {
    const aiKeywordMatch = aiKeywordMultipliersByUrl.get(candidate.url) ?? null;

    if (!aiKeywordMatch || aiKeywordMatch.multiplier <= 1) {
      return candidate;
    }

    return {
      ...candidate,
      aiKeywordMatch,
      scoreMultipliers: [...candidate.scoreMultipliers, aiKeywordMatch.multiplier],
    };
  });
}

async function buildAiKeywordMultipliersByUrl(candidatePool, context) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;

  if (!aiKeywordTools) {
    recordAiPredictionDiagnostic("prediction.ai.page-match.skip", {
      reason: "keyword-tools-unavailable",
      candidateCount: Array.isArray(candidatePool) ? candidatePool.length : 0,
    });
    return new Map();
  }
  const aiContext = await getAiInterestKeywordsForPreloading(context);
  const graph = context?.graph ?? null;

  if (
    !graph ||
    !Array.isArray(aiContext?.interestKeywords) ||
    aiContext.interestKeywords.length === 0
  ) {
    recordAiPredictionDiagnostic("prediction.ai.page-match.skip", {
      reason: !graph ? "graph-unavailable" : "interest-keywords-empty",
      candidateCount: Array.isArray(candidatePool) ? candidatePool.length : 0,
      interestKeywordCount: Array.isArray(aiContext?.interestKeywords)
        ? aiContext.interestKeywords.length
        : 0,
    });
    return new Map();
  }
  const targetPageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
    type: "get-page-keywords-batch",
    pageUrls: candidatePool.map((candidate) => candidate.targetPageUrl).filter(Boolean),
  });

  const multipliersByUrl = new Map();
  let targetKeywordEntryCount = 0;
  let matchedCandidateCount = 0;
  let maxMultiplier = 1;

  for (const candidate of candidatePool) {
    const keywordEntryLookupUrl = normalizePageUrlForIndex(
      candidate.targetPageUrl || candidate.url || ""
    );
    const targetPageKeywordEntry =
      targetPageKeywordsByUrl?.[keywordEntryLookupUrl] ??
      null;
    if (targetPageKeywordEntry) {
      targetKeywordEntryCount += 1;
    }
    const aiKeywordMatch = aiKeywordTools.buildAiKeywordMatchResult({
      interestKeywords: aiContext.interestKeywords,
      candidate,
      targetPageKeywordEntry,
    });
    if (aiKeywordMatch?.multiplier > 1) {
      matchedCandidateCount += 1;
      maxMultiplier = Math.max(maxMultiplier, Number(aiKeywordMatch.multiplier) || 1);
    }
    multipliersByUrl.set(candidate.url, aiKeywordMatch);
  }

  recordAiPredictionDiagnostic("prediction.ai.page-match.result", {
    candidateCount: candidatePool.length,
    interestKeywordCount: aiContext.interestKeywords.length,
    targetKeywordEntryCount,
    matchedCandidateCount,
    maxMultiplier,
  });

  return multipliersByUrl;
}

globalThis.ZeroLatencyPreloadScoringAiKeywords = {
  appendAiKeywordScoreMultipliers,
  buildAiKeywordMultipliersByUrl,
};
