(function () {
  function normalizeTrackingTabStateMap(rawTabState) {
    if (!isPlainObject(rawTabState)) {
      return {};
    }

    const nextTabState = {};

    for (const [tabId, rawEntry] of Object.entries(rawTabState)) {
      if (!isPlainObject(rawEntry)) {
        continue;
      }

      const normalizedTabId = normalizePositiveInteger(tabId);

      if (normalizedTabId === null) {
        continue;
      }

      nextTabState[String(normalizedTabId)] = {
        nodeId: typeof rawEntry.nodeId === "string" ? rawEntry.nodeId : null,
        url: typeof rawEntry.url === "string" ? rawEntry.url : "",
        updatedAt: typeof rawEntry.updatedAt === "string" ? rawEntry.updatedAt : null,
      };
    }

    return nextTabState;
  }

  function normalizePendingSourceMap(rawPendingSources) {
    if (!isPlainObject(rawPendingSources)) {
      return {};
    }

    const nextPendingSources = {};
    const referenceTime = Date.now();

    for (const [tabId, rawEntry] of Object.entries(rawPendingSources)) {
      if (!isPlainObject(rawEntry)) {
        continue;
      }

      const normalizedTabId = normalizePositiveInteger(tabId);

      if (normalizedTabId === null) {
        continue;
      }

      const createdAt = typeof rawEntry.createdAt === "string" ? rawEntry.createdAt : null;

      if (isIsoTimestampStale(createdAt, PENDING_SOURCE_TTL_MS, referenceTime)) {
        continue;
      }

      nextPendingSources[String(normalizedTabId)] = {
        nodeId: typeof rawEntry.nodeId === "string" ? rawEntry.nodeId : null,
        pageUrl: normalizePageUrlForIndex(rawEntry.pageUrl || "") || "",
        createdAt,
      };
    }

    return nextPendingSources;
  }

  globalThis.normalizeTrackingTabStateMap = normalizeTrackingTabStateMap;
  globalThis.normalizePendingSourceMap = normalizePendingSourceMap;
})();
