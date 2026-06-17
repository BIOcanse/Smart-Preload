function buildPreloadSchedulerScoreSignals(scoredCandidatePool, settings) {
  const signals = {
    native: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
    tab: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
  };

  for (const candidate of Array.isArray(scoredCandidatePool) ? scoredCandidatePool : []) {
    if (candidate?.bookmarkPreload) {
      continue;
    }

    const selectionGroup =
      determinePreloadStrategy(candidate, settings) === "hidden-tab" ? "tab" : "native";
    const score = Number(candidate?.score);

    signals[selectionGroup].scoreSum += buildSchedulerLinkScoreSignal(score);
    signals[selectionGroup].candidateCount += 1;
  }

  signals.native.linkValueMultiplier = buildSchedulerLinkValueMultiplier(
    signals.native.scoreSum
  );
  signals.tab.linkValueMultiplier = buildSchedulerLinkValueMultiplier(signals.tab.scoreSum);
  return signals;
}

function buildSchedulerLinkScoreSignal(score) {
  const normalizedScore = Number(score);

  if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
    return 0;
  }

  return normalizedScore ** 1.5;
}
