function recordPreloadCandidateSelectionDiagnostics({
  message,
  sourceTab,
  sourceTabId,
  sourcePageUrl,
  selection,
}) {
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.selection", {
    sourceTabId,
    sourceWindowId: sourceTab.windowId,
    sourceUrl: sourcePageUrl,
    candidateUrls: (Array.isArray(message.links) ? message.links : [])
      .map((link) => normalizeNavigableUrl(link?.url, sourcePageUrl))
      .filter(Boolean)
      .slice(0, 12),
    selectedTargets: selection.selectedTargets.map((target) => ({
      url: target.url,
      strategy: target.strategy,
      score: target.score,
      transitionMetrics: target.transitionMetrics ?? null,
      scoreBreakdown: target.scoreBreakdown ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      targetHint: target.targetHint,
    })),
  });
  globalThis.ZeroLatencyDiagnostics?.record?.("prediction.final-top", {
    sourceTabId,
    sourceWindowId: sourceTab.windowId,
    sourceUrl: sourcePageUrl,
    candidateCount: Array.isArray(message.links) ? message.links.length : 0,
    selectedTargets: selection.selectedTargets.map((target, index) => ({
      rank: index + 1,
      url: target.url,
      nodeId: target.nodeId,
      strategy: target.strategy,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      siteSelection: target.siteSelection ?? null,
      targetHint: target.targetHint,
    })),
    tabTargets: selection.tabTargets.map((target) => target.url),
    prerenderTargets: selection.prerenderTargets.map((target) => target.url),
    prefetchTargets: selection.prefetchTargets.map((target) => target.url),
  });
}
