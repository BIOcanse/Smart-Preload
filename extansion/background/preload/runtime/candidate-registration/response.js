function buildPreloadCandidateRegistrationResponse({
  runtimeSettings,
  featureSupport,
  selection,
}) {
  return {
    ok: true,
    preloadedCount: selection.tabTargets.length,
    prerenderCount: selection.prerenderTargets.length,
    prefetchCount: selection.prefetchTargets.length,
    prerenderTargets: selection.prerenderTargets,
    prefetchTargets: selection.prefetchTargets,
    contentScriptPolicy: {
      ignoreWaterfallDynamicLinks:
        runtimeSettings.preloading.ignoreWaterfallDynamicLinks !== false,
    },
    crossSiteCurrentTabSwapEnabled:
      isCrossSiteCurrentTabSwapStrategyEnabled(runtimeSettings),
    featureSupport,
    targets: selection.selectedTargets.map((target) => ({
      url: target.url,
      score: target.score,
      nodeId: target.nodeId,
      targetHint: target.targetHint,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      bookmarkPreload: target.bookmarkPreload ?? null,
      siteSelection: target.siteSelection ?? null,
      strategy: target.strategy,
    })),
  };
}
