function buildSelectionFromTargets(targets) {
  const selectedTargets = (Array.isArray(targets) ? targets : [])
    .map(normalizePreloadCandidateSelectionTarget)
    .filter(Boolean)
    .sort(compareStoredSelectionTargetPriority);

  return {
    selectedTargets,
    prerenderTargets: selectedTargets
      .filter((target) => target.strategy === "prerender")
      .map((target) => ({
        url: target.url,
        targetHint: target.targetHint,
      })),
    prefetchTargets: selectedTargets
      .filter((target) => target.strategy === "prefetch")
      .map((target) => ({
        url: target.url,
      })),
    tabTargets: selectedTargets
      .filter((target) => target.strategy === "hidden-tab")
      .map((target) => ({
        url: target.url,
        nodeId: target.nodeId,
        score: target.score,
        scoreBreakdown: target.scoreBreakdown ?? null,
        transitionMetrics: target.transitionMetrics ?? null,
        targetHint: target.targetHint,
        aiKeywordMatch: target.aiKeywordMatch ?? null,
        bookmarkPreload: target.bookmarkPreload ?? null,
        siteSelection: target.siteSelection ?? null,
      })),
  };
}

function stripHiddenTabTargetsForResourcePressure(selection) {
  const selectedTargets = (Array.isArray(selection?.selectedTargets)
    ? selection.selectedTargets
    : []
  ).filter((target) => target?.strategy !== "hidden-tab");

  return buildSelectionFromTargets(selectedTargets);
}
