function rememberPreloadCandidateSelectionSnapshot(preloadState, snapshot) {
  preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
  preloadState.scheduler.candidateSelectionSnapshotsByTabId[
    String(snapshot.sourceTabId)
  ] = snapshot;
  preloadState.scheduler.updatedAt = snapshot.updatedAt;
  preloadState.updatedAt = snapshot.updatedAt;
  recordSchedulerSnapshotEvent("scheduler.snapshot.remember", {
    sourceTabId: snapshot.sourceTabId,
    sourceWindowId: snapshot.sourceWindowId,
    sourcePageUrl: snapshot.sourcePageUrl,
    updatedAt: snapshot.updatedAt,
    scoreSignals: summarizeScoreSignals(snapshot.scoreSignals),
    selectedCounts: countTargetsByStrategy(snapshot.selectedTargets),
  });
}

function prunePreloadCandidateSelectionSnapshots(preloadState, openTabs) {
  const openTabById = new Map(
    (Array.isArray(openTabs) ? openTabs : [])
      .filter((tab) => normalizePositiveInteger(tab?.id) !== null)
      .map((tab) => [String(tab.id), tab])
  );
  const snapshots = preloadState.scheduler?.candidateSelectionSnapshotsByTabId || {};

  for (const [sourceTabId, snapshot] of Object.entries(snapshots)) {
    const openTab = openTabById.get(sourceTabId);
    const currentPageUrl = normalizePageUrlForIndex(openTab?.url || "");

    if (!openTab || currentPageUrl !== snapshot.sourcePageUrl) {
      recordSchedulerSnapshotEvent("scheduler.snapshot.prune", {
        sourceTabId: snapshot.sourceTabId,
        sourceWindowId: snapshot.sourceWindowId,
        sourcePageUrl: snapshot.sourcePageUrl,
        currentPageUrl,
        reason: !openTab ? "tab-closed" : "page-url-changed",
      });
      delete snapshots[sourceTabId];
    }
  }
}

function buildPreloadCandidateSelectionSnapshot({
  sourceTab,
  sourceTabId,
  sourcePageUrl,
  currentNodeId,
  message,
  selection,
  scoredCandidatePool,
  settings,
}) {
  const normalizedSourceTabId = normalizePositiveInteger(sourceTabId ?? sourceTab?.id);
  const normalizedSourceWindowId = normalizePositiveInteger(sourceTab?.windowId);
  const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || sourceTab?.url || "");

  if (
    normalizedSourceTabId === null ||
    normalizedSourceWindowId === null ||
    !normalizedSourcePageUrl
  ) {
    return null;
  }

  return normalizePreloadCandidateSelectionSnapshot({
    sourceTabId: normalizedSourceTabId,
    sourceWindowId: normalizedSourceWindowId,
    sourcePageUrl: normalizedSourcePageUrl,
    currentNodeId: typeof currentNodeId === "string" ? currentNodeId : "",
    currentPageTitle:
      typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab?.title || "",
    currentPageTextDigest:
      typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
    currentPageContentFingerprint:
      typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
    scoreSignals: buildSnapshotScoreSignals(scoredCandidatePool, settings),
    candidateLinks: Array.isArray(message?.links) ? message.links : [],
    updatedAt: new Date().toISOString(),
    selectedTargets: selection?.selectedTargets ?? [],
  });
}

function buildSnapshotScoreSignals(scoredCandidatePool, settings) {
  if (typeof buildPreloadSchedulerScoreSignals !== "function") {
    return normalizePreloadSchedulerScoreSignals(null);
  }

  return normalizePreloadSchedulerScoreSignals(
    buildPreloadSchedulerScoreSignals(scoredCandidatePool, settings)
  );
}

function summarizeScoreSignals(scoreSignals) {
  const signals = normalizePreloadSchedulerScoreSignals(scoreSignals);

  return {
    native: summarizeScoreSignal(signals.native),
    tab: summarizeScoreSignal(signals.tab),
  };
}

function summarizeScoreSignal(signal) {
  const linkValueMultiplier = resolveSnapshotSummaryLinkValueMultiplier(signal);

  return {
    candidateCount: signal.candidateCount,
    scoreSum: signal.scoreSum,
    linkValueMultiplier,
  };
}

function resolveSnapshotSummaryLinkValueMultiplier(scoreSignal) {
  const storedMultiplier = Number(scoreSignal?.linkValueMultiplier);

  if (Number.isFinite(storedMultiplier) && storedMultiplier > 0) {
    return storedMultiplier;
  }

  return buildSchedulerLinkValueMultiplier(scoreSignal?.scoreSum);
}

function countTargetsByStrategy(targets) {
  const counts = {
    selected: 0,
    hiddenTab: 0,
    prerender: 0,
    prefetch: 0,
  };

  for (const target of Array.isArray(targets) ? targets : []) {
    counts.selected += 1;

    if (target?.strategy === "hidden-tab") {
      counts.hiddenTab += 1;
    } else if (target?.strategy === "prerender") {
      counts.prerender += 1;
    } else if (target?.strategy === "prefetch") {
      counts.prefetch += 1;
    }
  }

  return counts;
}

function summarizeSelectionTargets(targets) {
  return (Array.isArray(targets) ? targets : []).slice(0, 12).map((target, index) => ({
    rank: index + 1,
    url: target.url,
    strategy: target.strategy,
    score: target.score,
  }));
}

function recordSchedulerSnapshotEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
