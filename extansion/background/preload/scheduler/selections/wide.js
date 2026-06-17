async function buildWideSelectionForSnapshot({
  sourceTab,
  sourceTabId,
  sourcePageUrl,
  currentNodeId,
  message,
  scoredCandidatePool,
  settings,
  graph,
}) {
  if (
    typeof selectPreloadTargetsFromScoredCandidatePool !== "function" ||
    !Array.isArray(scoredCandidatePool)
  ) {
    return null;
  }

  try {
    return await selectPreloadTargetsFromScoredCandidatePool({
      scoredCandidatePool,
      sourceUrl: sourcePageUrl || sourceTab?.url || "",
      sourceWindowId: sourceTab?.windowId,
      sourceTabId,
      currentPageTitle:
        typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab?.title || "",
      currentPageTextDigest:
        typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
      currentPageContentFingerprint:
        typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
      graph,
      settings,
      slotLimits: buildSchedulerDiscoverySlotLimits(settings),
      ignoreConfiguredSourceSlotCaps: true,
    });
  } catch (error) {
    console.warn("Failed to build wide scheduler snapshot selection.", error);
    return null;
  }
}

function buildSchedulerDiscoverySlotLimits(settings) {
  const schedulerSettings = getEffectiveSchedulerSettings(settings);

  return {
    nativePageSlotLimit: schedulerSettings.nativeTotalMax,
    tabPageSlotLimit: schedulerSettings.tabTotalMax,
  };
}
