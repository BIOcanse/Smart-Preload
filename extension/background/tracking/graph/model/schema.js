const MAX_RECENT_FOREGROUND_PAGES = 6;
const MAX_HISTORY_PAGE_POOL_SIZE = 5;

function createEmptyGraph() {
  return {
    version: 13,
    nodes: {},
    edges: {},
    transitionBuckets: createEmptyTransitionBuckets(),
    transitionMessageBuckets: createEmptyTransitionMessageBuckets(),
    pageTransitionBuckets: createEmptyPageTransitionBuckets(),
    externalPageTransitionBuckets: createEmptyPageTransitionBuckets(),
    intraSitePageTransitionBuckets: createEmptyPageTransitionBuckets(),
    pageTransitionMessageBuckets: createEmptyPageTransitionMessageBuckets(),
    bookmarkPreloadBuckets: createEmptyBookmarkPreloadBuckets(),
    linkBehaviorStore: {},
    pageKeywordStore: {},
    pageKeywordBuckets: createEmptyPageKeywordBuckets(),
    recentForegroundPages: [],
    historyPageTitles: [],
    historyPageUrls: [],
    historyPageTexts: [],
    transitionMessages: [],
    transitionMessagesByDay: {},
    transitionSequence: 0,
    updatedAt: null,
  };
}

function createEmptyBookmarkPreloadBuckets() {
  return {
    startupGoogleSearch: {},
    newGoogleSearchTab: {},
  };
}

function normalizeBookmarkPreloadBuckets(rawBuckets) {
  const buckets = isPlainObject(rawBuckets) ? rawBuckets : {};

  return {
    startupGoogleSearch: normalizeBookmarkPreloadBucketLayer(
      buckets.startupGoogleSearch
    ),
    newGoogleSearchTab: normalizeBookmarkPreloadBucketLayer(
      buckets.newGoogleSearchTab
    ),
  };
}

function normalizeBookmarkPreloadBucketLayer(rawLayer) {
  const layer = isPlainObject(rawLayer) ? rawLayer : {};
  const normalizedLayer = {};

  for (const [rawPageUrl, rawCount] of Object.entries(layer)) {
    const pageUrl = normalizePageUrlForIndex(rawPageUrl || "");
    const count = clampNonNegativeInt(rawCount, 0);

    if (!pageUrl || count <= 0) {
      continue;
    }

    normalizedLayer[pageUrl] = count;
  }

  return normalizedLayer;
}

function createEmptyTransitionBuckets() {
  return {
    total: createEmptyBucketLayer(),
    byDay: {},
  };
}

function createEmptyBucketLayer() {
  return Array.from({ length: OUTBOUND_BUCKET_COUNT }, () => ({}));
}

function createEmptyTransitionMessageBuckets() {
  return {
    buckets: createEmptyBucketLayer(),
  };
}

function createEmptyPageTransitionBuckets() {
  return {
    total: createEmptyPageBucketLayer(),
    byDay: {},
  };
}

function createEmptyPageTransitionMessageBuckets() {
  return {
    buckets: createEmptyPageBucketLayer(),
  };
}

function createEmptyPageBucketLayer() {
  return Array.from({ length: OUTBOUND_BUCKET_COUNT }, () => ({}));
}

function createEmptyPageKeywordBuckets() {
  return {
    byKeyword: {},
  };
}

function createEmptyTransitionStats() {
  return {
    total: 0,
    last365d: 0,
    last30d: 0,
    last7d: 0,
    last1d: 0,
  };
}
