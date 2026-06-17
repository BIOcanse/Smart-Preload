function getSnapshotTargetsForGroup(snapshot, group, settings) {
  const targets = Array.isArray(snapshot?.selectedTargets) ? snapshot.selectedTargets : [];
  const allNativePreloadMode =
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      settings
    ) === true;

  if (allNativePreloadMode && group === "tab") {
    return [];
  }

  return targets
    .filter((target) => {
      if (allNativePreloadMode && group === "native") {
        return true;
      }

      return group === "tab"
        ? target.strategy === "hidden-tab"
        : target.strategy !== "hidden-tab";
    })
    .map((target) => normalizeSnapshotTargetForNativeOnlyMode(target, settings))
    .sort(compareStoredSelectionTargetPriority);
}

function getSnapshotScoreSignalForGroup(snapshot, group, settings) {
  const scoreSignals = normalizePreloadSchedulerScoreSignals(snapshot?.scoreSignals);
  const allNativePreloadMode =
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      settings
    ) === true;

  if (allNativePreloadMode && group === "tab") {
    return {
      scoreSum: 0,
      candidateCount: 0,
    };
  }

  if (allNativePreloadMode && group === "native") {
    const mergedSignal = {
      scoreSum: scoreSignals.native.scoreSum + scoreSignals.tab.scoreSum,
      candidateCount:
        scoreSignals.native.candidateCount + scoreSignals.tab.candidateCount,
    };

    if (mergedSignal.candidateCount > 0) {
      return mergedSignal;
    }
  }

  const signal = group === "tab" ? scoreSignals.tab : scoreSignals.native;

  if (signal.candidateCount > 0) {
    return signal;
  }

  const targets = getSnapshotTargetsForGroup(snapshot, group, settings).filter(
    (target) => !isIndependentBookmarkPreloadTarget(target)
  );

  return {
    scoreSum: sumSelectionTargetScores(targets),
    candidateCount: targets.length,
  };
}

function normalizeSnapshotTargetForNativeOnlyMode(target, settings) {
  const strategy =
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.resolveHiddenTabStrategyForNativeOnlyMode?.(
      target?.strategy,
      settings
    ) ?? target?.strategy;

  if (strategy === target?.strategy) {
    return target;
  }

  return {
    ...target,
    strategy,
  };
}

function shouldKeepProxyAllowedSnapshotTarget(target, settings) {
  return (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
      target?.url,
      settings
    ) !== true
  );
}

function sumSelectionTargetScores(targets) {
  return (Array.isArray(targets) ? targets : []).reduce((sum, target) => {
    if (isIndependentBookmarkPreloadTarget(target)) {
      return sum;
    }

    const score = Number(target?.score);
    return sum + buildSchedulerLinkScoreSignal(score);
  }, 0);
}

function buildSchedulerLinkScoreSignal(score) {
  const normalizedScore = Number(score);

  if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
    return 0;
  }

  return normalizedScore ** 1.5;
}
