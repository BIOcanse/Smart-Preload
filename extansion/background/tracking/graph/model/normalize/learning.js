function normalizePageKeywordStore(rawPageKeywordStore) {
  if (!isPlainObject(rawPageKeywordStore)) {
    return {};
  }

  const nextPageKeywordStore = {};

  for (const [pageUrl, rawEntry] of Object.entries(rawPageKeywordStore)) {
    const normalizedEntry = normalizePageKeywordEntry(pageUrl, rawEntry);

    if (!normalizedEntry) {
      continue;
    }

    nextPageKeywordStore[normalizedEntry.pageUrl] = normalizedEntry;
  }

  return nextPageKeywordStore;
}

function normalizeLinkBehaviorStore(rawLinkBehaviorStore) {
  if (!isPlainObject(rawLinkBehaviorStore)) {
    return {};
  }

  const nextLinkBehaviorStore = {};

  for (const [rawSourcePageUrl, rawTargets] of Object.entries(rawLinkBehaviorStore)) {
    const sourcePageUrl = normalizePageUrlForIndex(rawSourcePageUrl);

    if (!sourcePageUrl || !isPlainObject(rawTargets)) {
      continue;
    }

    const nextTargetMap = {};

    for (const [rawTargetUrl, rawBehavior] of Object.entries(rawTargets)) {
      const targetUrl = normalizePageUrlForIndex(rawTargetUrl);
      const normalizedBehavior = normalizeLinkBehaviorRecord(rawBehavior);

      if (!targetUrl || !normalizedBehavior) {
        continue;
      }

      nextTargetMap[targetUrl] = normalizedBehavior;
    }

    if (Object.keys(nextTargetMap).length > 0) {
      nextLinkBehaviorStore[sourcePageUrl] = nextTargetMap;
    }
  }

  return nextLinkBehaviorStore;
}

function normalizeLinkBehaviorRecord(rawBehavior) {
  if (!isPlainObject(rawBehavior)) {
    return null;
  }

  return {
    selfCount: clampNonNegativeInt(rawBehavior.selfCount, 0),
    blankCount: clampNonNegativeInt(rawBehavior.blankCount, 0),
    lastTargetHint: rawBehavior.lastTargetHint === "_blank" ? "_blank" : "_self",
    lastSeenAt: typeof rawBehavior.lastSeenAt === "string" ? rawBehavior.lastSeenAt : null,
  };
}

function normalizePageKeywordEntry(pageUrl, rawEntry) {
  const normalizedPageUrl = normalizePageUrlForIndex(pageUrl || rawEntry?.pageUrl || "");

  if (!normalizedPageUrl || !isPlainObject(rawEntry)) {
    return null;
  }

  const keywords = Array.isArray(rawEntry.keywords)
    ? rawEntry.keywords
        .filter((keyword) => isPlainObject(keyword))
        .map((keyword) => ({
          text: String(keyword.text || "").trim(),
          score: clampKeywordScore(keyword.score),
        }))
        .filter((keyword) => keyword.text.length > 0)
        .slice(0, 8)
    : [];

  return {
    pageUrl: normalizedPageUrl,
    siteNodeId: typeof rawEntry.siteNodeId === "string" ? rawEntry.siteNodeId : "",
    title: typeof rawEntry.title === "string" ? rawEntry.title : "",
    keywords,
    pageType:
      typeof rawEntry.pageType === "string" && rawEntry.pageType.trim()
        ? rawEntry.pageType.trim()
        : null,
    generatedAt: typeof rawEntry.generatedAt === "string" ? rawEntry.generatedAt : null,
    expiresAt: typeof rawEntry.expiresAt === "string" ? rawEntry.expiresAt : null,
    modelId: typeof rawEntry.modelId === "string" ? rawEntry.modelId : "",
    contentFingerprint:
      typeof rawEntry.contentFingerprint === "string" ? rawEntry.contentFingerprint : "",
  };
}

function normalizeRecentForegroundPages(rawRecentForegroundPages) {
  if (!Array.isArray(rawRecentForegroundPages)) {
    return [];
  }

  return rawRecentForegroundPages
    .filter((entry) => isPlainObject(entry))
    .map((entry) => ({
      tabId: Number.isFinite(Number(entry.tabId)) ? Number(entry.tabId) : -1,
      windowId: Number.isFinite(Number(entry.windowId)) ? Number(entry.windowId) : -1,
      nodeId: typeof entry.nodeId === "string" ? entry.nodeId : "",
      pageUrl: normalizePageUrlForIndex(entry.pageUrl || "") || "",
      title: typeof entry.title === "string" ? entry.title : "",
      textDigest: typeof entry.textDigest === "string" ? entry.textDigest : "",
      contentFingerprint:
        typeof entry.contentFingerprint === "string" ? entry.contentFingerprint : "",
      activatedAt: typeof entry.activatedAt === "string" ? entry.activatedAt : null,
      leftForegroundAt:
        typeof entry.leftForegroundAt === "string" ? entry.leftForegroundAt : null,
      wasPreloadedBeforeForeground: entry.wasPreloadedBeforeForeground === true,
    }))
    .filter((entry) => entry.pageUrl)
    .sort((left, right) =>
      String(right.activatedAt || "").localeCompare(String(left.activatedAt || ""))
    )
    .slice(0, MAX_RECENT_FOREGROUND_PAGES);
}

function normalizeHistoryPagePool(rawTitles, rawUrls, rawTexts, recentForegroundPages = []) {
  const entries = [];
  const normalizedTitles = Array.isArray(rawTitles) ? rawTitles : [];
  const normalizedUrls = Array.isArray(rawUrls) ? rawUrls : [];
  const normalizedTexts = Array.isArray(rawTexts) ? rawTexts : [];
  const maxInputLength = Math.max(
    normalizedTitles.length,
    normalizedUrls.length,
    normalizedTexts.length
  );

  for (let index = 0; index < maxInputLength; index += 1) {
    const pageUrl = normalizePageUrlForIndex(normalizedUrls[index] || "");

    if (!pageUrl) {
      continue;
    }

    entries.push({
      title: typeof normalizedTitles[index] === "string" ? normalizedTitles[index] : "",
      pageUrl,
      text: typeof normalizedTexts[index] === "string" ? normalizedTexts[index] : "",
    });
  }

  if (entries.length === 0 && Array.isArray(recentForegroundPages)) {
    for (const entry of recentForegroundPages) {
      if (!entry?.pageUrl) {
        continue;
      }

      entries.push({
        title: typeof entry.title === "string" ? entry.title : "",
        pageUrl: entry.pageUrl,
        text: typeof entry.textDigest === "string" ? entry.textDigest : "",
      });

      if (entries.length >= MAX_HISTORY_PAGE_POOL_SIZE) {
        break;
      }
    }
  }

  const dedupedEntries = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry.pageUrl || seen.has(entry.pageUrl)) {
      continue;
    }

    seen.add(entry.pageUrl);
    dedupedEntries.push(entry);

    if (dedupedEntries.length >= MAX_HISTORY_PAGE_POOL_SIZE) {
      break;
    }
  }

  return {
    titles: dedupedEntries.map((entry) => entry.title),
    urls: dedupedEntries.map((entry) => entry.pageUrl),
    texts: dedupedEntries.map((entry) => entry.text),
  };
}
