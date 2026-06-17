(function () {
  function normalizePreloadCandidateSelectionSnapshots(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const snapshots = {};

    for (const [tabId, rawSnapshot] of Object.entries(nextValue)) {
      const snapshot = normalizePreloadCandidateSelectionSnapshot(rawSnapshot, tabId);

      if (snapshot) {
        snapshots[String(snapshot.sourceTabId)] = snapshot;
      }
    }

    return snapshots;
  }

  function normalizePreloadCandidateSelectionSnapshot(rawSnapshot, fallbackTabId) {
    if (!isPlainObject(rawSnapshot)) {
      return null;
    }

    const sourceTabId =
      normalizePositiveInteger(rawSnapshot.sourceTabId) ??
      normalizePositiveInteger(fallbackTabId);
    const sourceWindowId = normalizePositiveInteger(rawSnapshot.sourceWindowId);
    const sourcePageUrl =
      typeof rawSnapshot.sourcePageUrl === "string" ? rawSnapshot.sourcePageUrl : "";

    if (sourceTabId === null || sourceWindowId === null || !sourcePageUrl) {
      return null;
    }

    return {
      sourceTabId,
      sourceWindowId,
      sourcePageUrl,
      currentNodeId: typeof rawSnapshot.currentNodeId === "string" ? rawSnapshot.currentNodeId : "",
      currentPageTitle:
        typeof rawSnapshot.currentPageTitle === "string" ? rawSnapshot.currentPageTitle : "",
      currentPageTextDigest:
        typeof rawSnapshot.currentPageTextDigest === "string"
          ? rawSnapshot.currentPageTextDigest
          : "",
      currentPageContentFingerprint:
        typeof rawSnapshot.currentPageContentFingerprint === "string"
          ? rawSnapshot.currentPageContentFingerprint
          : "",
      scoreSignals: normalizePreloadSchedulerScoreSignals(rawSnapshot.scoreSignals),
      candidateLinks: (Array.isArray(rawSnapshot.candidateLinks)
        ? rawSnapshot.candidateLinks
        : [])
        .map(normalizePreloadCandidateSnapshotLink)
        .filter(Boolean)
        .slice(0, 80),
      updatedAt: typeof rawSnapshot.updatedAt === "string" ? rawSnapshot.updatedAt : null,
      selectedTargets: (Array.isArray(rawSnapshot.selectedTargets)
        ? rawSnapshot.selectedTargets
        : [])
        .map(normalizePreloadCandidateSelectionTarget)
        .filter(Boolean)
        .slice(0, 128),
    };
  }

  function normalizePreloadCandidateSelectionTarget(rawTarget) {
    if (!isPlainObject(rawTarget)) {
      return null;
    }

    const url = typeof rawTarget.url === "string" ? rawTarget.url : "";
    const strategy = typeof rawTarget.strategy === "string" ? rawTarget.strategy : "";

    if (!url || !["hidden-tab", "prerender", "prefetch"].includes(strategy)) {
      return null;
    }

    return {
      url,
      nodeId: typeof rawTarget.nodeId === "string" ? rawTarget.nodeId : "",
      score: clampNonNegativeNumber(rawTarget.score, 0),
      scoreBreakdown: normalizeScoreBreakdown(rawTarget.scoreBreakdown),
      transitionMetrics: normalizeTransitionMetrics(rawTarget.transitionMetrics),
      targetHint: typeof rawTarget.targetHint === "string" ? rawTarget.targetHint : null,
      aiKeywordMatch: normalizeAiKeywordMatch(rawTarget.aiKeywordMatch),
      bookmarkPreload: normalizeBookmarkPreloadMetadata(rawTarget.bookmarkPreload),
      siteSelection: normalizeSiteSelection(rawTarget.siteSelection),
      strategy,
    };
  }

  function normalizePreloadCandidateSnapshotLink(rawLink) {
    if (!isPlainObject(rawLink)) {
      return null;
    }

    const url = typeof rawLink.url === "string" ? rawLink.url : "";

    if (!url) {
      return null;
    }

    return {
      url,
      targetHint: rawLink.targetHint === "_blank" ? "_blank" : "_self",
      visibility: clampNonNegativeNumber(rawLink.visibility, 0),
      anchorText: typeof rawLink.anchorText === "string" ? rawLink.anchorText : "",
      nearbyText: typeof rawLink.nearbyText === "string" ? rawLink.nearbyText : "",
      titleAttr: typeof rawLink.titleAttr === "string" ? rawLink.titleAttr : "",
      ariaLabel: typeof rawLink.ariaLabel === "string" ? rawLink.ariaLabel : "",
      imageAlt: typeof rawLink.imageAlt === "string" ? rawLink.imageAlt : "",
    };
  }

  function normalizePreloadSchedulerScoreSignals(rawSignals) {
    const nextSignals = isPlainObject(rawSignals) ? rawSignals : {};

    return {
      native: normalizePreloadSchedulerScoreSignal(nextSignals.native),
      tab: normalizePreloadSchedulerScoreSignal(nextSignals.tab),
    };
  }

  function normalizePreloadSchedulerScoreSignal(rawSignal) {
    const nextSignal = isPlainObject(rawSignal) ? rawSignal : {};

    return {
      scoreSum: clampNonNegativeNumber(nextSignal.scoreSum, 0),
      candidateCount: clampNonNegativeInt(nextSignal.candidateCount, 0),
      linkValueMultiplier: clampNonNegativeNumber(nextSignal.linkValueMultiplier, 0),
    };
  }

  globalThis.normalizePreloadCandidateSelectionSnapshots =
    normalizePreloadCandidateSelectionSnapshots;
  globalThis.normalizePreloadCandidateSelectionSnapshot =
    normalizePreloadCandidateSelectionSnapshot;
  globalThis.normalizePreloadCandidateSelectionTarget =
    normalizePreloadCandidateSelectionTarget;
  globalThis.normalizePreloadCandidateSnapshotLink =
    normalizePreloadCandidateSnapshotLink;
  globalThis.normalizePreloadSchedulerScoreSignals =
    normalizePreloadSchedulerScoreSignals;
  globalThis.normalizePreloadSchedulerScoreSignal =
    normalizePreloadSchedulerScoreSignal;
})();
