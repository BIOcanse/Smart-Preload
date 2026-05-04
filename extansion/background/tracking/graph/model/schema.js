const MAX_RECENT_FOREGROUND_PAGES = 6;
const MAX_HISTORY_PAGE_POOL_SIZE = 5;

function createEmptyGraph() {
  return {
    version: 12,
    nodes: {},
    edges: {},
    transitionBuckets: createEmptyTransitionBuckets(),
    transitionMessageBuckets: createEmptyTransitionMessageBuckets(),
    pageTransitionBuckets: createEmptyPageTransitionBuckets(),
    externalPageTransitionBuckets: createEmptyPageTransitionBuckets(),
    intraSitePageTransitionBuckets: createEmptyPageTransitionBuckets(),
    pageTransitionMessageBuckets: createEmptyPageTransitionMessageBuckets(),
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
