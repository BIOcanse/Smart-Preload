(function () {
  const { normalizeWeight } = globalThis.ZeroLatencyPreloadAttentionOptions;
  const { normalizeAttentionPageUrl } = globalThis.ZeroLatencyPreloadAttentionPool;

  function buildAttentionCursorFromObservation(observation, observedAt) {
    const tabId = normalizePositiveInteger(observation?.tabId);
    const windowId = normalizePositiveInteger(observation?.windowId);
    const pageUrl = normalizeAttentionPageUrl(observation?.pageUrl || "");
    const rawWeight = Object.prototype.hasOwnProperty.call(observation || {}, "weight")
      ? observation.weight
      : 1;
    const counting =
      observation?.counting !== false &&
      tabId !== null &&
      windowId !== null &&
      Boolean(pageUrl) &&
      normalizeWeight(rawWeight, 0) > 0;
    const weight = counting ? normalizeWeight(rawWeight, 1) : 0;

    return {
      tabId,
      windowId,
      pageUrl,
      observedAt,
      counting,
      weight,
      activityKind:
        counting && typeof observation?.activityKind === "string"
          ? observation.activityKind
          : "inactive",
      expiresAt:
        counting && typeof observation?.expiresAt === "string"
          ? observation.expiresAt
          : null,
      pendingDurationMs: 0,
      pendingStartedAt: null,
    };
  }

  function summarizeAttentionCursor(cursor) {
    return {
      tabId: cursor?.tabId ?? null,
      windowId: cursor?.windowId ?? null,
      pageUrl: cursor?.pageUrl || "",
      observedAt: cursor?.observedAt || null,
      counting: cursor?.counting === true,
      weight: Number(cursor?.weight) || 0,
      activityKind: cursor?.activityKind || "inactive",
      expiresAt: cursor?.expiresAt || null,
      pendingDurationMs: clampNonNegativeNumber(cursor?.pendingDurationMs, 0),
    };
  }

  globalThis.ZeroLatencyPreloadAttentionCursor = {
    buildAttentionCursorFromObservation,
    summarizeAttentionCursor,
  };
})();
