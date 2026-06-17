async function schedulePreloadCandidateSelectionSnapshots({
  snapshots,
  preloadState,
  settings,
  graph,
}) {
  const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => normalizePreloadCandidateSelectionSnapshot(snapshot))
    .filter(Boolean)
    .filter(
      (snapshot) =>
        globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadUrl?.(
          snapshot.sourcePageUrl,
          settings
        ) !== true
    );

  recordSchedulerEvent("scheduler.schedule.start", {
    mode: graph ? "candidate-rebuild" : "stored-snapshot",
    snapshotCount: normalizedSnapshots.length,
    attentionPoolTotalDurationMs: preloadState?.scheduler?.attentionPool?.totalDurationMs ?? 0,
    snapshots: normalizedSnapshots.map((snapshot) => ({
      sourceTabId: snapshot.sourceTabId,
      sourceWindowId: snapshot.sourceWindowId,
      sourcePageUrl: snapshot.sourcePageUrl,
      scoreSignals: summarizeScoreSignals(snapshot.scoreSignals),
      selectedCounts: countTargetsByStrategy(snapshot.selectedTargets),
    })),
  });

  if (normalizedSnapshots.length === 0) {
    return [];
  }

  const schedulerSettings = getEffectiveSchedulerSettings(settings);
  const pressureState =
    typeof getPreloadResourcePressureState === "function"
      ? await getPreloadResourcePressureState(settings).catch(() => null)
      : null;
  const allNativePreloadMode =
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      settings
    ) === true;
  const shouldDeferHiddenTabs = pressureState?.shouldDeferHiddenTabs === true;
  const dwellShares =
    globalThis.ZeroLatencyPreloadSchedulerAttention.computePreloadAttentionDwellShares(
      preloadState?.scheduler?.attentionPool,
      normalizedSnapshots.map((snapshot) => ({
        tabId: snapshot.sourceTabId,
        pageUrl: snapshot.sourcePageUrl,
      }))
    );
  const nativeAllocations = allocateSchedulerGroupSlots({
    snapshots: normalizedSnapshots,
    schedulerSettings,
    runtimeSettings: settings,
    group: "native",
    dwellShares,
    preloadState,
  });
  const tabAllocations = shouldDeferHiddenTabs || allNativePreloadMode
    ? new Map()
    : allocateSchedulerGroupSlots({
        snapshots: normalizedSnapshots,
        schedulerSettings,
        runtimeSettings: settings,
        group: "tab",
        dwellShares,
        preloadState,
      });

  if (shouldDeferHiddenTabs) {
    recordSchedulerEvent("scheduler.resource-pressure.hidden-tab-deferred", {
      policy: pressureState.policy,
      reason: pressureState.reason,
      snapshotCount: normalizedSnapshots.length,
    });
  }
  if (allNativePreloadMode) {
    recordSchedulerEvent("scheduler.native-only.hidden-tab-deferred", {
      snapshotCount: normalizedSnapshots.length,
    });
  }

  return Promise.all(normalizedSnapshots.map(async (snapshot) => {
    const sourceTabId = String(snapshot.sourceTabId);
    const nativeSlots = nativeAllocations.get(sourceTabId) ?? 0;
    const tabSlots = tabAllocations.get(sourceTabId) ?? 0;
    const fallbackSelection = buildLimitedSelectionFromSnapshot(snapshot, {
      nativeSlots,
      tabSlots,
      settings,
    });
    let selection = await buildScheduledSelectionForSnapshot(snapshot, {
      nativeSlots,
      tabSlots,
      fallbackSelection,
      graph,
      settings,
    });

    if (shouldDeferHiddenTabs || allNativePreloadMode) {
      selection = stripHiddenTabTargetsForResourcePressure(selection);
    }
    recordSchedulerEvent("scheduler.selection.result", {
      mode: graph ? "candidate-rebuild" : "stored-snapshot",
      sourceTabId: snapshot.sourceTabId,
      sourceWindowId: snapshot.sourceWindowId,
      sourcePageUrl: snapshot.sourcePageUrl,
      nativeSlots,
      tabSlots,
      selectedCounts: countSelectionTargets(selection),
      selectedTargets: summarizeSelectionTargets(selection.selectedTargets),
    });

    return {
      sourceTabId: snapshot.sourceTabId,
      sourceWindowId: snapshot.sourceWindowId,
      sourcePageUrl: snapshot.sourcePageUrl,
      nativeSlots,
      tabSlots,
      selection,
    };
  }));
}
