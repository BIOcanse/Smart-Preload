(function () {
  function normalizePreloadWindowState(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};

    return {
      windowId: normalizePositiveInteger(nextValue.windowId),
      hwnd: normalizePositiveFiniteNumber(nextValue.hwnd),
      hiddenBySystem: nextValue.hiddenBySystem === true,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizeHiddenTabPreloadEntry(rawEntry) {
    const nextEntry = isPlainObject(rawEntry) ? rawEntry : {};

    return {
      tabId: normalizePositiveInteger(nextEntry.tabId),
      requestedUrl: typeof nextEntry.requestedUrl === "string" ? nextEntry.requestedUrl : "",
      loadedUrl: typeof nextEntry.loadedUrl === "string" ? nextEntry.loadedUrl : null,
      nodeId: typeof nextEntry.nodeId === "string" ? nextEntry.nodeId : "",
      score: clampNonNegativeNumber(nextEntry.score, 0),
      scoreBreakdown: normalizeScoreBreakdown(nextEntry.scoreBreakdown),
      transitionMetrics: normalizeTransitionMetrics(nextEntry.transitionMetrics),
      status: typeof nextEntry.status === "string" ? nextEntry.status : "queued",
      aiKeywordMatch: normalizeAiKeywordMatch(nextEntry.aiKeywordMatch),
      siteSelection: normalizeSiteSelection(nextEntry.siteSelection),
      createdAt: typeof nextEntry.createdAt === "string" ? nextEntry.createdAt : null,
      updatedAt: typeof nextEntry.updatedAt === "string" ? nextEntry.updatedAt : null,
    };
  }

  function normalizeSyntheticPreloadEntry(rawEntry, strategy) {
    const nextEntry = isPlainObject(rawEntry) ? rawEntry : {};

    return {
      requestedUrl: typeof nextEntry.requestedUrl === "string" ? nextEntry.requestedUrl : "",
      nodeId: typeof nextEntry.nodeId === "string" ? nextEntry.nodeId : "",
      score: clampNonNegativeNumber(nextEntry.score, 0),
      scoreBreakdown: normalizeScoreBreakdown(nextEntry.scoreBreakdown),
      transitionMetrics: normalizeTransitionMetrics(nextEntry.transitionMetrics),
      status: typeof nextEntry.status === "string" ? nextEntry.status : strategy,
      strategy,
      targetHint: typeof nextEntry.targetHint === "string" ? nextEntry.targetHint : null,
      aiKeywordMatch: normalizeAiKeywordMatch(nextEntry.aiKeywordMatch),
      siteSelection: normalizeSiteSelection(nextEntry.siteSelection),
      updatedAt: typeof nextEntry.updatedAt === "string" ? nextEntry.updatedAt : null,
    };
  }

  function normalizeScoreBreakdown(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const multipliers = Array.isArray(nextValue.multipliers)
      ? nextValue.multipliers
          .map((multiplier) => clampNonNegativeNumber(multiplier, null))
          .filter((multiplier) => multiplier !== null)
      : [];

    return {
      baseScore: clampNonNegativeNumber(nextValue.baseScore, 0),
      combinedScore: clampNonNegativeNumber(nextValue.combinedScore, 0),
      normalizedScore: clampNonNegativeNumber(nextValue.normalizedScore, 0),
      effectiveMultiplierCount: clampNonNegativeInt(nextValue.effectiveMultiplierCount, 0),
      multipliers,
    };
  }

  function normalizeTransitionMetrics(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    return {
      siteTransitionCount: clampNonNegativeInt(nextValue.siteTransitionCount, 0),
      outboundPageTransitionCount: clampNonNegativeInt(
        nextValue.outboundPageTransitionCount,
        0
      ),
      intraSitePageTransitionCount: clampNonNegativeInt(
        nextValue.intraSitePageTransitionCount,
        0
      ),
      pageTransitionCount: clampNonNegativeInt(nextValue.pageTransitionCount, 0),
    };
  }

  function normalizeAiKeywordMatch(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const multiplier = Number(nextValue.multiplier);
    const matchStrength = Number(nextValue.matchStrength ?? nextValue.strength);
    const matchedKeywords = Array.isArray(nextValue.matchedKeywords)
      ? nextValue.matchedKeywords
          .map((entry) => ({
            interestKeyword:
              typeof entry?.interestKeyword === "string"
                ? entry.interestKeyword
                : typeof entry?.text === "string"
                  ? entry.text
                  : "",
            field: typeof entry?.field === "string" ? entry.field : "",
            matchedText:
              typeof entry?.matchedText === "string"
                ? entry.matchedText
                : typeof entry?.source === "string"
                  ? entry.source
                  : "",
            contribution: Number.isFinite(Number(entry?.contribution))
              ? Number(entry.contribution)
              : Number.isFinite(Number(entry?.score))
                ? Number(entry.score)
                : null,
          }))
          .filter((entry) => entry.interestKeyword)
          .slice(0, 5)
      : [];

    return {
      matchTier:
        typeof nextValue.matchTier === "string"
          ? nextValue.matchTier
          : typeof nextValue.tier === "string"
            ? nextValue.tier
            : "none",
      multiplier: Number.isFinite(multiplier) ? multiplier : 1,
      matchStrength: Number.isFinite(matchStrength) ? matchStrength : 0,
      matchedKeywords,
    };
  }

  function normalizeSiteSelection(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const siteWeight = Number(nextValue.siteWeight);
    const siteTransitionCount = Number(nextValue.siteTransitionCount);
    const cap = Number(nextValue.cap);
    const allocatedSlots = Number(nextValue.allocatedSlots);
    const siteRank = Number(nextValue.siteRank);

    return {
      siteNodeId: typeof nextValue.siteNodeId === "string" ? nextValue.siteNodeId : "",
      siteWeight: Number.isFinite(siteWeight) ? siteWeight : 0,
      siteTransitionCount: Number.isFinite(siteTransitionCount) ? siteTransitionCount : 0,
      cap: Number.isFinite(cap) ? Math.max(0, Math.trunc(cap)) : 0,
      allocatedSlots: Number.isFinite(allocatedSlots) ? Math.max(0, Math.trunc(allocatedSlots)) : 0,
      siteRank: Number.isFinite(siteRank) ? Math.max(0, Math.trunc(siteRank)) : 0,
      selectionGroup: typeof nextValue.selectionGroup === "string" ? nextValue.selectionGroup : "",
      aiKeywordMatch: normalizeAiKeywordMatch(nextValue.aiKeywordMatch),
    };
  }

  globalThis.normalizePreloadWindowState = normalizePreloadWindowState;
  globalThis.normalizeHiddenTabPreloadEntry = normalizeHiddenTabPreloadEntry;
  globalThis.normalizeSyntheticPreloadEntry = normalizeSyntheticPreloadEntry;
})();
