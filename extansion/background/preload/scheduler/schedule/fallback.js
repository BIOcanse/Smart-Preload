function buildLimitedSelectionFromSnapshot(snapshot, limits) {
  const selectedTargets = [];
  const nativeTargets = getSnapshotTargetsForGroup(
    snapshot,
    "native",
    limits?.settings
  ).filter((target) => shouldKeepProxyAllowedSnapshotTarget(target, limits?.settings));
  const tabTargets = getSnapshotTargetsForGroup(
    snapshot,
    "tab",
    limits?.settings
  ).filter((target) => shouldKeepProxyAllowedSnapshotTarget(target, limits?.settings));
  const nativeQuotaTargets = nativeTargets
    .filter((target) => !isIndependentBookmarkPreloadTarget(target))
    .slice(0, limits.nativeSlots);
  const tabQuotaTargets = tabTargets
    .filter((target) => !isIndependentBookmarkPreloadTarget(target))
    .slice(0, limits.tabSlots);
  const independentTargets = [...nativeTargets, ...tabTargets].filter((target) =>
    shouldKeepIndependentBookmarkPreloadTarget(target, snapshot, limits?.settings)
  );

  selectedTargets.push(...nativeQuotaTargets, ...tabQuotaTargets, ...independentTargets);
  selectedTargets.sort(compareStoredSelectionTargetPriority);

  return buildSelectionFromTargets(selectedTargets);
}

globalThis.ZeroLatencyPreloadSchedulerScheduleFallback = {
  buildLimitedSelectionFromSnapshot,
};
