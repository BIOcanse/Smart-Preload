const AI_INTEREST_KEYWORD_CACHE_TTL_MS = 15_000;
const aiInterestKeywordCache = new Map();

function getCachedAiInterestKeywordPromise(cacheKey) {
  const cachedEntry = aiInterestKeywordCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.promise;
  }

  return null;
}

function setCachedAiInterestKeywordPromise(cacheKey, promise) {
  aiInterestKeywordCache.set(cacheKey, {
    expiresAt: Date.now() + AI_INTEREST_KEYWORD_CACHE_TTL_MS,
    promise,
  });
  pruneAiInterestKeywordCache();
}

function buildAiInterestKeywordCacheKey({
  aiPredictionSettings,
  currentPage,
  openPages,
  recentForegroundPageRecords,
  historyPageRecords,
}) {
  return JSON.stringify({
    providerId: aiPredictionSettings.providerId || "",
    modelId: aiPredictionSettings.modelId || "",
    currentPageUrl: currentPage?.pageUrl || "",
    currentFingerprint: currentPage?.contentFingerprint || "",
    openPageUrls: (openPages || []).map((page) => page.pageUrl),
    recentForegroundPageUrls: recentForegroundPageRecords.map((page) => page.pageUrl),
    historyPageUrls: historyPageRecords.map((page) => page.pageUrl),
  });
}

function pruneAiInterestKeywordCache() {
  const now = Date.now();

  for (const [cacheKey, cacheEntry] of aiInterestKeywordCache.entries()) {
    if (!cacheEntry || cacheEntry.expiresAt <= now) {
      aiInterestKeywordCache.delete(cacheKey);
    }
  }
}
