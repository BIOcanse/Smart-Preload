function indexPageKeywordEntry(graph, pageKeywordEntry) {
  if (!isPlainObject(graph.pageKeywordBuckets)) {
    graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();
  }

  const byKeyword = isPlainObject(graph.pageKeywordBuckets.byKeyword)
    ? graph.pageKeywordBuckets.byKeyword
    : (graph.pageKeywordBuckets.byKeyword = {});

  for (const keyword of pageKeywordEntry?.keywords ?? []) {
    const keywordKey = normalizeKeywordToken(keyword?.text);

    if (!keywordKey) {
      continue;
    }

    const keywordBucket = byKeyword[keywordKey] || (byKeyword[keywordKey] = {});
    keywordBucket[pageKeywordEntry.pageUrl] = clampKeywordIndexScore(keyword?.score);
  }
}

function getPageKeywordEntry(graph, pageUrl) {
  const normalizedPageUrl = normalizePageUrlForIndex(pageUrl || "");

  if (!normalizedPageUrl) {
    return null;
  }

  return graph.pageKeywordStore?.[normalizedPageUrl] ?? null;
}

function getRecentForegroundPages(graph, limit = 6) {
  const normalizedLimit = Math.max(1, clampNonNegativeInt(limit, 6));
  return Array.isArray(graph.recentForegroundPages)
    ? graph.recentForegroundPages.slice(0, normalizedLimit)
    : [];
}

function getHistoryPagePool(graph, limit = 5) {
  const normalizedLimit = Math.max(1, clampNonNegativeInt(limit, 5));
  const titles = Array.isArray(graph?.historyPageTitles)
    ? graph.historyPageTitles.slice(0, normalizedLimit)
    : [];
  const urls = Array.isArray(graph?.historyPageUrls)
    ? graph.historyPageUrls.slice(0, normalizedLimit)
    : [];
  const texts = Array.isArray(graph?.historyPageTexts)
    ? graph.historyPageTexts.slice(0, normalizedLimit)
    : [];

  return {
    titles,
    urls,
    texts,
  };
}

function getPageKeywordEntriesByUrl(graph, pageUrls) {
  const normalizedPageUrls = Array.isArray(pageUrls) ? pageUrls : [];
  const result = {};

  for (const pageUrl of normalizedPageUrls) {
    const normalizedPageUrl = normalizePageUrlForIndex(pageUrl || "");

    if (!normalizedPageUrl || result[normalizedPageUrl]) {
      continue;
    }

    const keywordEntry = getPageKeywordEntry(graph, normalizedPageUrl);

    if (keywordEntry) {
      result[normalizedPageUrl] = keywordEntry;
    }
  }

  return result;
}

function normalizeKeywordToken(value) {
  return String(value || "").trim().toLowerCase();
}

function clampKeywordIndexScore(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue));
}
