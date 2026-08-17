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

// 把一条 entry 对倒排索引的贡献撤销掉，用于「同一 pageUrl 被覆盖写入」时先减后加。
//
// 没有它的话，逐条写入只能靠丢弃整个 byKeyword 再把**整个 store** 重新索引一遍，
// 于是写入 n 条的总代价是 O(n²)。而 pageKeywordStore 按设计无上限增长
// （见 docs/internal/invariants.md 第 7 条），这个平方项会一直放大。
function unindexPageKeywordEntry(graph, pageKeywordEntry) {
  const byKeyword = isPlainObject(graph.pageKeywordBuckets?.byKeyword)
    ? graph.pageKeywordBuckets.byKeyword
    : null;

  if (!byKeyword || !pageKeywordEntry?.pageUrl) {
    return;
  }

  for (const keyword of pageKeywordEntry?.keywords ?? []) {
    const keywordKey = normalizeKeywordToken(keyword?.text);

    if (!keywordKey) {
      continue;
    }

    const keywordBucket = byKeyword[keywordKey];

    if (!isPlainObject(keywordBucket)) {
      continue;
    }

    delete keywordBucket[pageKeywordEntry.pageUrl];

    // 桶空了就删掉，避免倒排表里堆积只剩空对象的关键词——那会让后续遍历和
    // 序列化都白白变大。
    if (Object.keys(keywordBucket).length === 0) {
      delete byKeyword[keywordKey];
    }
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
