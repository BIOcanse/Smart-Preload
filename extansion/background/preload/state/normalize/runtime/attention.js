(function () {
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

  globalThis.normalizePreloadSchedulerState = normalizePreloadSchedulerState;
  globalThis.normalizePreloadAttentionPool = normalizePreloadAttentionPool;
  globalThis.normalizePreloadAttentionSegment = normalizePreloadAttentionSegment;
  globalThis.normalizePreloadAttentionPendingByKey = normalizePreloadAttentionPendingByKey;
  globalThis.normalizePreloadAttentionCursor = normalizePreloadAttentionCursor;
})();
