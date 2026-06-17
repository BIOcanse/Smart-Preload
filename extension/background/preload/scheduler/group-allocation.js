function allocateSchedulerGroupSlots({
  snapshots,
  schedulerSettings,
  runtimeSettings,
  group,
  dwellShares,
  preloadState,
}) {
  const totalCap = resolveSchedulerGroupTotalCap(schedulerSettings, group, snapshots.length);
  const allocationInputs = snapshots
    .map((snapshot, index) => {
      const scoreSignal = getSnapshotScoreSignalForGroup(
        snapshot,
        group,
        runtimeSettings
      );
      const dwellShare = resolveSnapshotDwellShare(snapshot, dwellShares, preloadState);
      const linkValueMultiplier = resolveSnapshotLinkValueMultiplier(scoreSignal);
      const finalScore =
        scoreSignal.candidateCount > 0 && dwellShare > 0
          ? linkValueMultiplier * dwellShare
          : 0;
      const sourceSlotCap = resolveSchedulerGroupSourceSlotCap(
        runtimeSettings,
        group,
        scoreSignal.candidateCount
      );

      return {
        tabId: snapshot.sourceTabId,
        sourceWindowId: snapshot.sourceWindowId,
        sourcePageUrl: snapshot.sourcePageUrl,
        score: finalScore,
        scoreSum: scoreSignal.scoreSum,
        linkValueMultiplier,
        dwellShare,
        candidateCount: scoreSignal.candidateCount,
        cap: sourceSlotCap,
        active: isActiveAttentionCursorSnapshot(snapshot, preloadState),
        lastActiveAt: getSnapshotLastActiveAt(snapshot, preloadState),
        order: index,
      };
    })
    .filter((input) => input.cap > 0);
  const allocations =
    globalThis.ZeroLatencyPreloadSchedulerAllocation.allocateTabPreloadSlots({
      totalCap,
      tabs: allocationInputs,
    });

  recordSchedulerGroupAllocationEvent("scheduler.allocation.group", {
    group,
    totalCap,
    inputCount: allocationInputs.length,
    inputs: allocationInputs.map((input) => ({
      tabId: input.tabId,
      sourceWindowId: input.sourceWindowId,
      sourcePageUrl: input.sourcePageUrl,
      candidateCount: input.candidateCount,
      sourceSlotCap: input.cap,
      scoreSum: input.scoreSum,
      linkValueMultiplier: input.linkValueMultiplier,
      dwellShare: input.dwellShare,
      finalScore: input.score,
      active: input.active,
      lastActiveAt: input.lastActiveAt,
    })),
    allocations: allocations.map((allocation) => ({
      tabId: allocation.tabId,
      score: allocation.score,
      cap: allocation.cap,
      rawSlots: allocation.rawSlots,
      slots: allocation.slots,
    })),
  });

  return new Map(
    allocations.map((allocation) => [String(allocation.tabId), allocation.slots])
  );
}

function resolveSnapshotLinkValueMultiplier(scoreSignal) {
  const storedMultiplier = Number(scoreSignal?.linkValueMultiplier);

  if (Number.isFinite(storedMultiplier) && storedMultiplier > 0) {
    return storedMultiplier;
  }

  return buildSchedulerLinkValueMultiplier(scoreSignal?.scoreSum);
}

function resolveSchedulerGroupTotalCap(settings, group, tabCount) {
  const prefix = group === "tab" ? "tab" : "native";

  return globalThis.ZeroLatencyPreloadSchedulerAllocation.resolveAsymptoticPreloadCap({
    tabCount,
    minCap: settings[`${prefix}TotalMin`],
    maxCap: settings[`${prefix}TotalMax`],
    halfLifeTabs: settings[`${prefix}HalfLifeTabs`],
  });
}

function resolveSchedulerGroupSourceSlotCap(settings, group, candidateCount) {
  const normalizedCandidateCount = Math.max(0, Math.trunc(Number(candidateCount) || 0));

  if (normalizedCandidateCount <= 0) {
    return 0;
  }

  const configuredLimit =
    group === "tab"
      ? Number(settings?.preloading?.effectiveTabMaxPreloadsPerSource)
      : Number(settings?.preloading?.effectiveNativeMaxPreloadsPerSource);

  if (Number.isFinite(configuredLimit)) {
    return Math.min(normalizedCandidateCount, Math.max(1, Math.trunc(configuredLimit)));
  }

  const fallbackLimit =
    group === "tab"
      ? settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource
      : settingsApi.DEFAULT_SETTINGS.preloading.nativeMaxPreloadsPerSource ??
        settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource;

  return Math.min(normalizedCandidateCount, Math.max(1, Math.trunc(fallbackLimit)));
}

function resolveSnapshotDwellShare(snapshot, dwellShares, preloadState) {
  const sourceTabId = String(snapshot.sourceTabId);
  const dwellShare = Number(dwellShares?.[sourceTabId]);

  if (Number.isFinite(dwellShare) && dwellShare > 0) {
    return Math.min(1, dwellShare);
  }

  if (isActiveAttentionCursorSnapshot(snapshot, preloadState)) {
    return 1;
  }

  return Number.isFinite(dwellShare) ? Math.max(0, dwellShare) : 1;
}

function isActiveAttentionCursorSnapshot(snapshot, preloadState) {
  const cursor = normalizePreloadAttentionCursor(
    preloadState?.scheduler?.activeTabCursor
  );

  return (
    cursor.counting === true &&
    Number(cursor.tabId) === Number(snapshot.sourceTabId) &&
    cursor.pageUrl === snapshot.sourcePageUrl
  );
}

function getSnapshotLastActiveAt(snapshot, preloadState) {
  return isActiveAttentionCursorSnapshot(snapshot, preloadState)
    ? preloadState?.scheduler?.activeTabCursor?.observedAt
    : snapshot.updatedAt;
}

function getEffectiveSchedulerSettings(settings) {
  const schedulerSettings =
    settings?.preloading?.effectivePreloadScheduler ??
    settings?.preloading?.scheduler ??
    settingsApi.DEFAULT_SETTINGS.preloading.scheduler;

  return {
    ...settingsApi.DEFAULT_SETTINGS.preloading.scheduler,
    ...(schedulerSettings || {}),
  };
}

function recordSchedulerGroupAllocationEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
