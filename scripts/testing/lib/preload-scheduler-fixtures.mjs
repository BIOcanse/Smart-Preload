export function createPreloadSchedulerFixtures(context) {
  function buildSnapshot({ sourceTabId, sourcePageUrl, hiddenScores, nativeScores, scoreSignals }) {
    return context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId,
      sourceWindowId: 10,
      sourcePageUrl,
      updatedAt: "2026-01-01T00:00:00.000Z",
      scoreSignals,
      selectedTargets: [
        ...hiddenScores.map((score, index) =>
          buildTarget(sourceTabId, "hidden-tab", score, index)
        ),
        ...nativeScores.map((score, index) =>
          buildTarget(sourceTabId, index % 2 === 0 ? "prerender" : "prefetch", score, index)
        ),
      ],
    });
  }

  function buildTarget(sourceTabId, strategy, score, index, extra = {}) {
    return {
      url: `https://target.example/${sourceTabId}/${strategy}/${index}`,
      nodeId: `https://target.example/${sourceTabId}`,
      score,
      targetHint: "_self",
      strategy,
      ...extra,
    };
  }

  function buildCandidateLink(sourceTabId, strategy, index) {
    return {
      url: `https://target.example/${sourceTabId}/${strategy}/${index}`,
      targetHint: "_self",
      visibility: 100,
      strategy,
    };
  }

  function buildExpectedSchedulerScoreSum(scores) {
    return (Array.isArray(scores) ? scores : []).reduce(
      (sum, score) => sum + buildExpectedSchedulerLinkScoreSignal(score),
      0
    );
  }

  function buildExpectedSchedulerLinkScoreSignal(score) {
    const normalizedScore = Number(score);

    if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
      return 0;
    }

    return normalizedScore ** 1.5;
  }

  return {
    buildCandidateLink,
    buildExpectedSchedulerLinkScoreSignal,
    buildExpectedSchedulerScoreSum,
    buildSnapshot,
    buildTarget,
  };
}
