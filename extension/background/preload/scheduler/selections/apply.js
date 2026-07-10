(function () {
  async function applyPreloadSchedulerCandidateSelection({
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    currentNodeId,
    message,
    selection,
    scoredCandidatePool,
    settings,
    graph,
  }) {
    const snapshotSelection =
      selection ??
      (await buildWideSelectionForSnapshot({
        sourceTab,
        sourceTabId,
        sourcePageUrl,
        currentNodeId,
        message,
        scoredCandidatePool,
        settings,
        graph,
      }));
    const sourceSnapshot = buildPreloadCandidateSelectionSnapshot({
      sourceTab,
      sourceTabId,
      sourcePageUrl,
      currentNodeId,
      message,
      selection: snapshotSelection,
      scoredCandidatePool,
      settings,
    });

    if (!sourceSnapshot) {
      return selection;
    }

    let currentSourceSelection = selection;
    const notifications = [];

    await queueMutation(async () => {
      let preloadState = await loadPreloadState();
      const openTabs = await queryOpenNormalTabs();

      preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
      rememberPreloadCandidateSelectionSnapshot(preloadState, sourceSnapshot);
      prunePreloadCandidateSelectionSnapshots(preloadState, openTabs);

      const snapshots = Object.values(
        preloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
      );
      const scheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
        snapshots,
        preloadState,
        settings,
        graph: null,
      });

      const synchronization = await synchronizeChangedScheduledPreloadSelections(
        preloadState,
        scheduledSelections
      );
      preloadState = synchronization.preloadState;
      notifications.push(...synchronization.changedSelections);

      for (const scheduledSelection of scheduledSelections) {
        if (Number(scheduledSelection.sourceTabId) === Number(sourceSnapshot.sourceTabId)) {
          currentSourceSelection = scheduledSelection.selection;
        }
      }

      await savePreloadState(preloadState);
    });

    await notifyScheduledSourceTabs(notifications);
    return currentSourceSelection;
  }

  globalThis.ZeroLatencyPreloadSchedulerSelectionsApply = {
    applyPreloadSchedulerCandidateSelection,
  };
})();
