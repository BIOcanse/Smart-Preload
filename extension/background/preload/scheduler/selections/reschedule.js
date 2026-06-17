(function () {
  async function rescheduleStoredPreloadSelections(preloadState, options = {}) {
    let nextPreloadState = isPlainObject(preloadState)
      ? preloadState
      : createEmptyPreloadState();
    const settings =
      options?.settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);
    const openTabs = await queryOpenNormalTabs();

    nextPreloadState.scheduler = normalizePreloadSchedulerState(nextPreloadState.scheduler);
    recordSchedulerEvent("scheduler.reschedule.stored.start", {
      reason: typeof options?.reason === "string" ? options.reason : "attention-pool-commit",
      snapshotCount: Object.keys(
        nextPreloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
      ).length,
      attentionPoolTotalDurationMs:
        nextPreloadState.scheduler.attentionPool?.totalDurationMs ?? 0,
    });
    prunePreloadCandidateSelectionSnapshots(nextPreloadState, openTabs);

    const snapshots = Object.values(
      nextPreloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
    );
    const scheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
      snapshots,
      preloadState: nextPreloadState,
      settings,
      graph: null,
    });

    for (const scheduledSelection of scheduledSelections) {
      nextPreloadState = await synchronizeScheduledPreloadSelection(
        nextPreloadState,
        scheduledSelection
      );
    }

    recordSchedulerEvent("scheduler.reschedule.stored.finish", {
      reason: typeof options?.reason === "string" ? options.reason : "attention-pool-commit",
      snapshotCount: snapshots.length,
      scheduledSourceTabCount: scheduledSelections.length,
      scheduledSourceTabIds: scheduledSelections.map((entry) => entry.sourceTabId),
      recomputedCandidateScores: false,
    });

    return {
      preloadState: nextPreloadState,
      scheduledSelections,
    };
  }

  globalThis.ZeroLatencyPreloadSchedulerSelectionsReschedule = {
    rescheduleStoredPreloadSelections,
  };
})();
