(function () {
  function normalizeSourceTabRuntime(rawValue, sourceTabId) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const hiddenTabEntriesByUrl = {};
    const prerenderEntriesByUrl = {};
    const prefetchEntriesByUrl = {};

    for (const [url, rawEntry] of Object.entries(nextValue.hiddenTabEntriesByUrl || {})) {
      const normalizedEntry = normalizeHiddenTabPreloadEntry(rawEntry);

      if (normalizedEntry.requestedUrl) {
        hiddenTabEntriesByUrl[url] = normalizedEntry;
      }
    }

    for (const [url, rawEntry] of Object.entries(nextValue.prerenderEntriesByUrl || {})) {
      const normalizedEntry = normalizeSyntheticPreloadEntry(rawEntry, "prerender");

      if (normalizedEntry.requestedUrl) {
        prerenderEntriesByUrl[url] = normalizedEntry;
      }
    }

    for (const [url, rawEntry] of Object.entries(nextValue.prefetchEntriesByUrl || {})) {
      const normalizedEntry = normalizeSyntheticPreloadEntry(rawEntry, "prefetch");

      if (normalizedEntry.requestedUrl) {
        prefetchEntriesByUrl[url] = normalizedEntry;
      }
    }

    return {
      sourceTabId:
        normalizePositiveInteger(nextValue.sourceTabId) ??
        normalizePositiveInteger(sourceTabId),
      hiddenTabEntriesByUrl,
      prerenderEntriesByUrl,
      prefetchEntriesByUrl,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizePreloadSchedulerState(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const attentionPool = normalizePreloadAttentionPool(nextValue.attentionPool);
    const activeTabCursor = normalizePreloadAttentionCursor(nextValue.activeTabCursor);
    const attentionPendingByKey = normalizePreloadAttentionPendingByKey(
      nextValue.attentionPendingByKey
    );
    const activePendingKey = buildPreloadAttentionPendingKey(activeTabCursor);

    if (
      activePendingKey &&
      activeTabCursor.pendingDurationMs > 0 &&
      !attentionPendingByKey[activePendingKey]
    ) {
      attentionPendingByKey[activePendingKey] = {
        tabId: activeTabCursor.tabId,
        windowId: activeTabCursor.windowId,
        pageUrl: activeTabCursor.pageUrl,
        durationMs: activeTabCursor.pendingDurationMs,
        startedAt: activeTabCursor.pendingStartedAt,
        updatedAt: activeTabCursor.observedAt,
      };
    }

    return {
      attentionPool,
      attentionPendingByKey,
      activeTabCursor,
      candidateSelectionSnapshotsByTabId: normalizePreloadCandidateSelectionSnapshots(
        nextValue.candidateSelectionSnapshotsByTabId
      ),
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : attentionPool.updatedAt,
    };
  }

  function normalizePreloadAttentionPendingByKey(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const pendingByKey = {};

    for (const [rawKey, rawEntry] of Object.entries(nextValue)) {
      const entry = normalizePreloadAttentionPendingEntry(rawEntry);
      const key = entry ? buildPreloadAttentionPendingKey(entry) : "";

      if (!entry || !key) {
        continue;
      }

      pendingByKey[key] = entry;
    }

    return pendingByKey;
  }

  function normalizePreloadAttentionPendingEntry(rawEntry) {
    if (!isPlainObject(rawEntry)) {
      return null;
    }

    const tabId = normalizePositiveInteger(rawEntry.tabId);
    const windowId = normalizePositiveInteger(rawEntry.windowId);
    const pageUrl = typeof rawEntry.pageUrl === "string" ? rawEntry.pageUrl : "";
    const durationMs = clampNonNegativeNumber(rawEntry.durationMs, 0);

    if (tabId === null || windowId === null || !pageUrl || durationMs <= 0) {
      return null;
    }

    return {
      tabId,
      windowId,
      pageUrl,
      durationMs,
      startedAt: typeof rawEntry.startedAt === "string" ? rawEntry.startedAt : null,
      updatedAt: typeof rawEntry.updatedAt === "string" ? rawEntry.updatedAt : null,
    };
  }

  function buildPreloadAttentionPendingKey(entry) {
    const tabId = normalizePositiveInteger(entry?.tabId);
    const pageUrl = typeof entry?.pageUrl === "string" ? entry.pageUrl : "";

    if (tabId === null || !pageUrl) {
      return "";
    }

    return `${tabId}\n${pageUrl}`;
  }

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

  function normalizePreloadAttentionPool(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const segments = [];
    let totalDurationMs = 0;

    for (const rawSegment of Array.isArray(nextValue.segments) ? nextValue.segments : []) {
      const segment = normalizePreloadAttentionSegment(rawSegment);

      if (!segment) {
        continue;
      }

      totalDurationMs += segment.durationMs;
      segments.push(segment);
    }

    return {
      segments,
      totalDurationMs,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizePreloadAttentionSegment(rawSegment) {
    if (!isPlainObject(rawSegment)) {
      return null;
    }

    const tabId = normalizePositiveInteger(rawSegment.tabId);
    const windowId = normalizePositiveInteger(rawSegment.windowId);
    const pageUrl = typeof rawSegment.pageUrl === "string" ? rawSegment.pageUrl : "";
    const durationMs = normalizePositiveFiniteNumber(rawSegment.durationMs);

    if (tabId === null || windowId === null || !pageUrl || durationMs === null) {
      return null;
    }

    return {
      tabId,
      windowId,
      pageUrl,
      durationMs,
      startedAt: typeof rawSegment.startedAt === "string" ? rawSegment.startedAt : null,
      endedAt: typeof rawSegment.endedAt === "string" ? rawSegment.endedAt : null,
    };
  }

  function normalizePreloadAttentionCursor(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const tabId = normalizePositiveInteger(nextValue.tabId);
    const windowId = normalizePositiveInteger(nextValue.windowId);

    return {
      tabId,
      windowId,
      pageUrl: typeof nextValue.pageUrl === "string" ? nextValue.pageUrl : "",
      observedAt: typeof nextValue.observedAt === "string" ? nextValue.observedAt : null,
      counting: nextValue.counting === true && tabId !== null && windowId !== null,
      weight: clampNonNegativeNumber(nextValue.weight, 0),
      activityKind:
        typeof nextValue.activityKind === "string" ? nextValue.activityKind : "inactive",
      expiresAt: typeof nextValue.expiresAt === "string" ? nextValue.expiresAt : null,
      pendingDurationMs: clampNonNegativeNumber(nextValue.pendingDurationMs, 0),
      pendingStartedAt:
        typeof nextValue.pendingStartedAt === "string" ? nextValue.pendingStartedAt : null,
    };
  }

  function normalizeNormalWindowRuntime(rawValue, normalWindowId) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};
    const normalizedWindowId =
      normalizePositiveInteger(nextValue.normalWindowId) ??
      normalizePositiveInteger(normalWindowId);
    const sourceTabs = {};

    for (const [sourceTabId, rawSourceTabRuntime] of Object.entries(nextValue.sourceTabs || {})) {
      const normalizedSourceTabRuntime = normalizeSourceTabRuntime(rawSourceTabRuntime, sourceTabId);

      if (normalizedSourceTabRuntime.sourceTabId !== null) {
        sourceTabs[String(normalizedSourceTabRuntime.sourceTabId)] = normalizedSourceTabRuntime;
      }
    }

    return {
      normalWindowId: normalizedWindowId,
      preloadWindow: normalizePreloadWindowState(nextValue.preloadWindow),
      sourceTabs,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizePreloadState(rawState) {
    const nextState = isPlainObject(rawState) ? rawState : createEmptyPreloadState();

    if (!isPlainObject(nextState.normalWindowsById)) {
      return createEmptyPreloadState();
    }

    const normalWindowsById = {};

    for (const [normalWindowId, rawWindowRuntime] of Object.entries(nextState.normalWindowsById)) {
      const normalizedWindowRuntime = normalizeNormalWindowRuntime(rawWindowRuntime, normalWindowId);

      if (normalizedWindowRuntime.normalWindowId !== null) {
        normalWindowsById[String(normalizedWindowRuntime.normalWindowId)] = normalizedWindowRuntime;
      }
    }

    return {
      version: 2,
      normalWindowsById,
      scheduler: normalizePreloadSchedulerState(nextState.scheduler),
      updatedAt: typeof nextState.updatedAt === "string" ? nextState.updatedAt : null,
    };
  }

  globalThis.normalizePreloadSchedulerState = normalizePreloadSchedulerState;
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
  globalThis.normalizePreloadAttentionPool = normalizePreloadAttentionPool;
  globalThis.normalizePreloadAttentionSegment = normalizePreloadAttentionSegment;
  globalThis.normalizePreloadAttentionPendingByKey = normalizePreloadAttentionPendingByKey;
  globalThis.normalizePreloadAttentionCursor = normalizePreloadAttentionCursor;
  globalThis.normalizeSourceTabRuntime = normalizeSourceTabRuntime;
  globalThis.normalizeNormalWindowRuntime = normalizeNormalWindowRuntime;
  globalThis.normalizePreloadState = normalizePreloadState;
})();
