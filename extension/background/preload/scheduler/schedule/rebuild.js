async function buildScheduledSelectionForSnapshot(snapshot, context) {
  const nativeSlots = Math.max(0, Math.trunc(Number(context?.nativeSlots) || 0));
  const tabSlots = Math.max(0, Math.trunc(Number(context?.tabSlots) || 0));

  if (
    !context?.graph ||
    typeof selectPreloadTargets !== "function" ||
    !Array.isArray(snapshot?.candidateLinks)
  ) {
    return (
      context?.fallbackSelection ??
      buildLimitedSelectionFromSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
        settings: context?.settings,
      })
    );
  }

  try {
    return await selectPreloadTargets({
      currentNodeId: snapshot.currentNodeId || buildNodeSeed(snapshot.sourcePageUrl).nodeId,
      sourceUrl: snapshot.sourcePageUrl,
      sourceWindowId: snapshot.sourceWindowId,
      sourceTabId: snapshot.sourceTabId,
      currentPageTitle: snapshot.currentPageTitle || "",
      currentPageTextDigest: snapshot.currentPageTextDigest || "",
      currentPageContentFingerprint: snapshot.currentPageContentFingerprint || "",
      candidateLinks: snapshot.candidateLinks,
      graph: context.graph,
      settings: context.settings,
      slotLimits: {
        nativePageSlotLimit: nativeSlots,
        tabPageSlotLimit: tabSlots,
      },
    });
  } catch (error) {
    console.warn("Failed to rebuild scheduled preload selection.", error);
    return (
      context?.fallbackSelection ??
      buildLimitedSelectionFromSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
        settings: context?.settings,
      })
    );
  }
}

globalThis.ZeroLatencyPreloadSchedulerScheduleRebuild = {
  buildScheduledSelectionForSnapshot,
};
