(function () {
  const {
    buildPreloadAttentionTabKey,
    normalizeAttentionPageUrl,
  } = globalThis.ZeroLatencyPreloadAttentionPool;

  function getPreloadAttentionPendingEntry(scheduler, tabRef) {
    const key = buildPreloadAttentionTabKey(tabRef);

    if (!key || !isPlainObject(scheduler?.attentionPendingByKey)) {
      return null;
    }

    return scheduler.attentionPendingByKey[key] || null;
  }

  function setPreloadAttentionPendingEntry(
    scheduler,
    tabRef,
    durationMs,
    startedAt,
    updatedAt
  ) {
    const key = buildPreloadAttentionTabKey(tabRef);

    if (!key) {
      return;
    }

    if (!isPlainObject(scheduler.attentionPendingByKey)) {
      scheduler.attentionPendingByKey = {};
    }

    const normalizedDurationMs = clampNonNegativeNumber(durationMs, 0);

    if (normalizedDurationMs <= 0) {
      delete scheduler.attentionPendingByKey[key];
      return;
    }

    scheduler.attentionPendingByKey[key] = {
      tabId: normalizePositiveInteger(tabRef?.tabId),
      windowId: normalizePositiveInteger(tabRef?.windowId),
      pageUrl: normalizeAttentionPageUrl(tabRef?.pageUrl || ""),
      durationMs: normalizedDurationMs,
      startedAt: typeof startedAt === "string" ? startedAt : null,
      updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    };
  }

  function applyPreloadAttentionPendingToCursor(cursor, scheduler) {
    cursor.pendingDurationMs = 0;
    cursor.pendingStartedAt = null;

    if (cursor.counting !== true) {
      return cursor;
    }

    const pendingEntry = getPreloadAttentionPendingEntry(scheduler, cursor);

    if (pendingEntry) {
      cursor.pendingDurationMs = clampNonNegativeNumber(pendingEntry.durationMs, 0);
      cursor.pendingStartedAt =
        typeof pendingEntry.startedAt === "string" ? pendingEntry.startedAt : null;
    }

    return cursor;
  }

  globalThis.ZeroLatencyPreloadAttentionPending = {
    getPreloadAttentionPendingEntry,
    setPreloadAttentionPendingEntry,
    applyPreloadAttentionPendingToCursor,
  };
})();
