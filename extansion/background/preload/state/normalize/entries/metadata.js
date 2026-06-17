(function () {
  function normalizeInteractionPreloadMetadata(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const trigger = nextValue.trigger === "contextmenu" ? "contextmenu" : "hover";
    const targetHint = nextValue.targetHint === "_blank" ? "_blank" : "_self";

    return {
      trigger,
      targetHint,
      startedAt: typeof nextValue.startedAt === "string" ? nextValue.startedAt : null,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  function normalizeRealPreloadSafety(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const reasons = Array.isArray(nextValue.reasons)
      ? nextValue.reasons
          .map((reason) => (typeof reason === "string" ? reason.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const sideEffectReasons = Array.isArray(nextValue.sideEffectReasons)
      ? nextValue.sideEffectReasons
          .map((reason) => (typeof reason === "string" ? reason.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const dangerousSiteReasons = Array.isArray(nextValue.dangerousSiteReasons)
      ? nextValue.dangerousSiteReasons
          .map((reason) => (typeof reason === "string" ? reason.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const sensitiveSiteReasons = Array.isArray(nextValue.sensitiveSiteReasons)
      ? nextValue.sensitiveSiteReasons
          .map((reason) => (typeof reason === "string" ? reason.trim() : ""))
          .filter(Boolean)
          .slice(0, 8)
      : [];
    const reason =
      typeof nextValue.reason === "string" && nextValue.reason.trim()
        ? nextValue.reason.trim()
        : reasons[0] || "";
    const rawDangerousSiteEvidence = isPlainObject(nextValue.dangerousSiteEvidence)
      ? nextValue.dangerousSiteEvidence
      : null;
    const dangerousSiteEvidence = rawDangerousSiteEvidence
      ? {
          verdict:
            typeof rawDangerousSiteEvidence.verdict === "string"
              ? rawDangerousSiteEvidence.verdict.trim()
              : "",
          reason:
            typeof rawDangerousSiteEvidence.reason === "string"
              ? rawDangerousSiteEvidence.reason.trim()
              : "",
          source:
            typeof rawDangerousSiteEvidence.source === "string"
              ? rawDangerousSiteEvidence.source.trim()
              : "",
          threatTypes: Array.isArray(rawDangerousSiteEvidence.threatTypes)
            ? rawDangerousSiteEvidence.threatTypes
                .map((threatType) =>
                  typeof threatType === "string" ? threatType.trim() : ""
                )
                .filter(Boolean)
                .slice(0, 8)
            : [],
        }
      : null;
    const rawSensitiveSiteEvidence = isPlainObject(nextValue.sensitiveSiteEvidence)
      ? nextValue.sensitiveSiteEvidence
      : null;
    const sensitiveSiteEvidence = rawSensitiveSiteEvidence
      ? {
          libraryVersion: Number(rawSensitiveSiteEvidence.libraryVersion) || 0,
          matches: Array.isArray(rawSensitiveSiteEvidence.matches)
            ? rawSensitiveSiteEvidence.matches
                .map((match) => ({
                  category: typeof match?.category === "string" ? match.category.trim() : "",
                  reason: typeof match?.reason === "string" ? match.reason.trim() : "",
                  field: typeof match?.field === "string" ? match.field.trim() : "",
                  value: typeof match?.value === "string" ? match.value.trim() : "",
                }))
                .filter((match) => match.category && match.reason)
                .slice(0, 12)
            : [],
        }
      : null;

    return {
      enabled: true,
      locked: true,
      skipPreload: nextValue.skipPreload === true,
      realPreloadBlocked: nextValue.realPreloadBlocked === true,
      sideEffectBlocked: nextValue.sideEffectBlocked === true,
      dangerousSiteBlocked: nextValue.dangerousSiteBlocked === true,
      sensitiveSiteBlocked: nextValue.sensitiveSiteBlocked === true,
      reason,
      reasons,
      sideEffectReasons,
      dangerousSiteReasons,
      sensitiveSiteReasons,
      dangerousSiteEvidence,
      sensitiveSiteEvidence,
    };
  }

  function normalizeBookmarkPreloadMetadata(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : null;

    if (!nextValue) {
      return null;
    }

    const startupGoogleSearchBucket =
      typeof BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH === "string"
        ? BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH
        : "startupGoogleSearch";
    const newGoogleSearchTabBucket =
      typeof BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB === "string"
        ? BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB
        : "newGoogleSearchTab";
    const bucketKey =
      nextValue.bucketKey === startupGoogleSearchBucket ||
      nextValue.bucketKey === newGoogleSearchTabBucket
        ? nextValue.bucketKey
        : "";

    if (!bucketKey) {
      return null;
    }

    return {
      bucketKey,
      count: clampNonNegativeInt(nextValue.count, 0),
      rank: clampNonNegativeInt(nextValue.rank, 0),
      title: typeof nextValue.title === "string" ? nextValue.title : "",
    };
  }

  globalThis.normalizeInteractionPreloadMetadata = normalizeInteractionPreloadMetadata;
  globalThis.normalizeRealPreloadSafety = normalizeRealPreloadSafety;
  globalThis.normalizeBookmarkPreloadMetadata = normalizeBookmarkPreloadMetadata;
})();
