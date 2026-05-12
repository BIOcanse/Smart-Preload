async function registerPreloadCandidates(message, sender) {
  const context = await resolvePreloadCandidateRegistrationContext(message, sender);

  if (!context.ok) {
    return context.response;
  }

  const { sourceTab, sourcePageUrl, runtimeSettings, featureSupport } = context;
  const { trackingState, sourceTabId, currentNodeId } =
    await buildPreloadCandidateSelectionContext(message, sourceTab);
  const selection = await selectPreloadTargets({
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
  });
  recordPreloadCandidateSelectionDiagnostics({
    message,
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    selection,
  });

  if (await isExtensionServicePaused()) {
    return {
      ok: true,
      preloadedCount: 0,
      skipped: true,
      reason: "service-paused-after-selection",
    };
  }

  await applyPreloadCandidateSelection({
    sourceTab,
    sourceTabId,
    selection,
  });

  return buildPreloadCandidateRegistrationResponse({
    runtimeSettings,
    featureSupport,
    selection,
  });
}
