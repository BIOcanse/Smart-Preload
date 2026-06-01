async function registerPreloadCandidates(message, sender) {
  const context = await resolvePreloadCandidateRegistrationContext(message, sender);

  if (!context.ok) {
    return context.response;
  }

  const { sourceTab, sourcePageUrl, runtimeSettings, featureSupport } = context;
  const { trackingState, sourceTabId, currentNodeId } =
    await buildPreloadCandidateSelectionContext(message, sourceTab);
  const selectionContext = {
    currentNodeId,
    sourceUrl: sourcePageUrl,
    sourceWindowId: sourceTab.windowId,
    sourceTabId,
    currentPageTitle:
      typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab.title || "",
    currentPageTextDigest:
      typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
    currentPageContentFingerprint:
      typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
    candidateLinks: Array.isArray(message.links) ? message.links : [],
    graph: trackingState.graph,
    settings: runtimeSettings,
  };
  const scoredCandidatePool = await buildScoredPreloadCandidatePool(selectionContext);

  if (await isExtensionServicePaused()) {
    return {
      ok: true,
      preloadedCount: 0,
      skipped: true,
      reason: "service-paused-after-scoring",
    };
  }

  const schedulerSelections = globalThis.ZeroLatencyPreloadSchedulerSelections;
  let selection = null;

  if (typeof schedulerSelections?.applyPreloadSchedulerCandidateSelection === "function") {
    selection = await schedulerSelections.applyPreloadSchedulerCandidateSelection({
      sourceTab,
      sourceTabId,
      sourcePageUrl,
      currentNodeId,
      message,
      scoredCandidatePool,
      settings: runtimeSettings,
      graph: trackingState.graph,
    });
  }

  if (!selection) {
    selection = await selectPreloadTargetsFromScoredCandidatePool({
      ...selectionContext,
      scoredCandidatePool,
      slotLimits:
        schedulerSelections?.buildSchedulerDiscoverySlotLimits?.(runtimeSettings) ?? null,
    });
  }

  recordPreloadCandidateSelectionDiagnostics({
    message,
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    selection,
  });

  return buildPreloadCandidateRegistrationResponse({
    runtimeSettings,
    featureSupport,
    selection,
  });
}
