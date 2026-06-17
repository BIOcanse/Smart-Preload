async function buildSiteAiKeywordMultipliersByNodeId(siteClusters, context) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const graph = context?.graph ?? null;

  if (!aiKeywordTools || !graph) {
    recordSiteAiPredictionDiagnostic("prediction.ai.site-match.skip", {
      reason: !aiKeywordTools ? "keyword-tools-unavailable" : "graph-unavailable",
      siteCount: Array.isArray(siteClusters) ? siteClusters.length : 0,
    });
    return new Map();
  }

  const aiContext =
    (typeof context?.getAiInterestContext === "function"
      ? await context.getAiInterestContext()
      : null) ?? (await getAiInterestKeywordsForPreloading(context));
  const interestKeywords = Array.isArray(aiContext?.interestKeywords)
    ? aiContext.interestKeywords
    : [];

  if (interestKeywords.length === 0) {
    recordSiteAiPredictionDiagnostic("prediction.ai.site-match.skip", {
      reason: "interest-keywords-empty",
      siteCount: Array.isArray(siteClusters) ? siteClusters.length : 0,
    });
    return new Map();
  }

  const targetPageUrls = [];

  for (const siteCluster of siteClusters) {
    for (const candidate of siteCluster.candidates) {
      if (candidate?.targetPageUrl) {
        targetPageUrls.push(candidate.targetPageUrl);
      } else if (candidate?.url) {
        targetPageUrls.push(candidate.url);
      }
    }
  }

  const targetPageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
    type: "get-page-keywords-batch",
    pageUrls: targetPageUrls,
  });
  const multipliersByNodeId = new Map();
  let matchedSiteCount = 0;
  let maxMultiplier = 1;

  for (const siteCluster of siteClusters) {
    const siteAiKeywordMatch = aiKeywordTools.buildSiteAiKeywordMatchResult({
      interestKeywords,
      siteCandidates: siteCluster.candidates,
      targetPageKeywordsByUrl,
    });

    if (siteAiKeywordMatch?.multiplier > 1) {
      matchedSiteCount += 1;
      maxMultiplier = Math.max(maxMultiplier, Number(siteAiKeywordMatch.multiplier) || 1);
    }
    multipliersByNodeId.set(siteCluster.nodeId, siteAiKeywordMatch);
  }

  recordSiteAiPredictionDiagnostic("prediction.ai.site-match.result", {
    siteCount: siteClusters.length,
    candidateCount: siteClusters.reduce(
      (sum, siteCluster) => sum + (siteCluster.candidates?.length ?? 0),
      0
    ),
    interestKeywordCount: interestKeywords.length,
    targetKeywordEntryCount: Object.keys(targetPageKeywordsByUrl || {}).length,
    matchedSiteCount,
    maxMultiplier,
  });

  return multipliersByNodeId;
}

function recordSiteAiPredictionDiagnostic(eventName, payload) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  globalThis.ZeroLatencyDiagnostics?.record?.(eventName, payload);
}
