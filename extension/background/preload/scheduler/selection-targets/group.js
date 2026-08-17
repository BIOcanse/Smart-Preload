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
    // buildSchedulerLinkScoreSignal 定义在 preload/prediction/strategy/signals.js。
    // 这里曾有一份逐字节相同的重复定义，但它在 service-worker 打包后被 signals.js
    // 的定义覆盖（load #241 vs #283），实际从不执行，已删除。
    // 重复顶层绑定由 scripts/testing/service-worker-bundle-integrity.mjs 把关。
    return sum + buildSchedulerLinkScoreSignal(score);
  }, 0);
}
