(function () {
  const {
    DEFAULT_ATTENTION_POOL_DURATION_MS,
    resolvePreloadAttentionOptions,
    normalizeDurationMs,
    parseTimestampMs,
    advanceIsoTimestamp,
  } = globalThis.ZeroLatencyPreloadAttentionOptions;

  function appendPreloadAttentionDuration(attentionPool, rawSegment, options = {}) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const resolvedOptions = resolvePreloadAttentionOptions(options);
    const baseSegment = normalizePreloadAttentionAppendSegment(rawSegment);

    if (!baseSegment) {
      return pool;
    }

    const startedAtMs =
      parseTimestampMs(baseSegment.startedAt) ??
      Math.max(0, baseSegment.endedAtMs - baseSegment.durationMs);
    let remainingDurationMs = baseSegment.durationMs;
    let nextStartedAtMs = startedAtMs;

    while (remainingDurationMs > 0) {
      const durationMs = Math.min(remainingDurationMs, resolvedOptions.segmentDurationMs);
      const endedAtMs = nextStartedAtMs + durationMs;

      pool.segments.push({
        tabId: baseSegment.tabId,
        windowId: baseSegment.windowId,
        pageUrl: baseSegment.pageUrl,
        durationMs,
        startedAt: new Date(nextStartedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
      });

      pool.totalDurationMs += durationMs;
      remainingDurationMs -= durationMs;
      nextStartedAtMs = endedAtMs;
    }

    pool.updatedAt = new Date(baseSegment.endedAtMs).toISOString();
    return trimPreloadAttentionPool(pool, resolvedOptions.poolDurationMs);
  }

  function trimPreloadAttentionPool(attentionPool, poolDurationMs) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const maxDurationMs = normalizeDurationMs(poolDurationMs, DEFAULT_ATTENTION_POOL_DURATION_MS);

    while (pool.totalDurationMs > maxDurationMs && pool.segments.length > 0) {
      const overflowMs = pool.totalDurationMs - maxDurationMs;
      const firstSegment = pool.segments[0];

      if (firstSegment.durationMs <= overflowMs) {
        pool.segments.shift();
        pool.totalDurationMs -= firstSegment.durationMs;
        continue;
      }

      firstSegment.durationMs -= overflowMs;
      firstSegment.startedAt = advanceIsoTimestamp(firstSegment.startedAt, overflowMs);
      pool.totalDurationMs -= overflowMs;
    }

    return pool;
  }

  function normalizePreloadAttentionAppendSegment(rawSegment) {
    const tabId = normalizePositiveInteger(rawSegment?.tabId);
    const windowId = normalizePositiveInteger(rawSegment?.windowId);
    const pageUrl = normalizeAttentionPageUrl(rawSegment?.pageUrl || "");
    const durationMs = normalizePositiveFiniteNumber(rawSegment?.durationMs);
    const endedAtMs = parseTimestampMs(rawSegment?.endedAt) ?? Date.now();

    if (tabId === null || windowId === null || !pageUrl || durationMs === null) {
      return null;
    }

    return {
      tabId,
      windowId,
      pageUrl,
      durationMs,
      startedAt: typeof rawSegment?.startedAt === "string" ? rawSegment.startedAt : null,
      endedAtMs,
    };
  }

  function computePreloadAttentionDwellShares(attentionPool, tabRefs, options = {}) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const resolvedOptions = resolvePreloadAttentionOptions(options);
    const siteShareRatio = resolvedOptions.siteShareRatio;
    const tabShareRatio = 1 - siteShareRatio;
    const refs = (Array.isArray(tabRefs) ? tabRefs : [])
      .map((tabRef) => ({
        key: buildPreloadAttentionTabKey(tabRef),
        siteKey: buildPreloadAttentionSiteKey(tabRef),
        tabId: normalizePositiveInteger(tabRef?.tabId),
      }))
      .filter((tabRef) => tabRef.key);
    const shareByTabId = {};

    if (refs.length === 0) {
      return shareByTabId;
    }

    if (pool.totalDurationMs <= 0) {
      for (const ref of refs) {
        shareByTabId[String(ref.tabId)] = 1;
      }
      return shareByTabId;
    }

    const requestedKeys = new Set(refs.map((ref) => ref.key));
    const refsBySiteKey = new Map();
    const durationByKey = {};

    for (const ref of refs) {
      if (!ref.siteKey) {
        continue;
      }

      if (!refsBySiteKey.has(ref.siteKey)) {
        refsBySiteKey.set(ref.siteKey, []);
      }

      refsBySiteKey.get(ref.siteKey).push(ref);
    }
    const siteDurationByKey = {};

    for (const segment of pool.segments) {
      const key = buildPreloadAttentionTabKey(segment);
      const siteKey = buildPreloadAttentionSiteKey(segment);

      if (requestedKeys.has(key)) {
        durationByKey[key] =
          (durationByKey[key] || 0) + segment.durationMs * tabShareRatio;
      }

      if (siteKey && refsBySiteKey.has(siteKey)) {
        siteDurationByKey[siteKey] =
          (siteDurationByKey[siteKey] || 0) + segment.durationMs * siteShareRatio;
      }
    }

    for (const ref of refs) {
      const siteRefs = refsBySiteKey.get(ref.siteKey) || [];
      const sharedSiteDuration =
        siteRefs.length > 0 ? (siteDurationByKey[ref.siteKey] || 0) / siteRefs.length : 0;
      shareByTabId[String(ref.tabId)] = Math.max(
        0,
        Math.min(
          1,
          ((durationByKey[ref.key] || 0) + sharedSiteDuration) / pool.totalDurationMs
        )
      );
    }

    return shareByTabId;
  }

  function buildPreloadAttentionTabKey(tabRef) {
    const tabId = normalizePositiveInteger(tabRef?.tabId);
    const pageUrl = normalizeAttentionPageUrl(tabRef?.pageUrl || "");

    if (tabId === null || !pageUrl) {
      return "";
    }

    return `${tabId}\n${pageUrl}`;
  }

  function buildPreloadAttentionSiteKey(tabRef) {
    const pageUrl = normalizeAttentionPageUrl(tabRef?.pageUrl || "");

    if (!pageUrl) {
      return "";
    }

    try {
      const url = new URL(pageUrl);
      return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch (_error) {
      return "";
    }
  }

  function normalizeAttentionPageUrl(rawUrl) {
    const value = typeof rawUrl === "string" ? rawUrl : "";

    if (!value) {
      return "";
    }

    return typeof normalizePageUrlForIndex === "function"
      ? normalizePageUrlForIndex(value)
      : value;
  }

  globalThis.ZeroLatencyPreloadAttentionPool = {
    appendPreloadAttentionDuration,
    trimPreloadAttentionPool,
    normalizePreloadAttentionAppendSegment,
    computePreloadAttentionDwellShares,
    buildPreloadAttentionTabKey,
    buildPreloadAttentionSiteKey,
    normalizeAttentionPageUrl,
  };
})();
