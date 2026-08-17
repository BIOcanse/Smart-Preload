// 图结构的 schema 版本。此前这个 14 硬编码在四处（schema.js、normalize/graph.js ×2、
// storage/tracking.js），改 schema 时极易漏改其中之一。
const TRACKING_GRAPH_SCHEMA_VERSION = 14;

// checkpoint 归一化戳：写进 graph 的 `normalizedBy`，冷启动时用它判断「这份数据是不是
// **本版本、本 schema** 亲手写出去的」。命中就整体跳过 normalize —— 那一整套逐条
// normalizeEdgeRecord / normalizeLinkBehaviorStore / normalizePageKeywordStore 全是对
// 扩展自己刚写出去的数据做防御性再校验，而它的代价是 O(图规模)：实测 2 万节点约 393 ms，
// 跑在 service worker 唯一的线程上、**每次冷启动**都要付一遍。
//
// 戳里必须同时含扩展版本与 schema 版本：只有 schema 版本的话，同一 schema 下的代码改动
// （比如某个 normalize 函数修了 bug）不会让旧数据重新走一遍归一化。
function buildTrackingGraphNormalizationStamp() {
  const extensionVersion =
    globalThis.chrome?.runtime?.getManifest?.()?.version || "unknown";

  return `${extensionVersion}:${TRACKING_GRAPH_SCHEMA_VERSION}`;
}

const MAX_RECENT_FOREGROUND_PAGES = 6;
const MAX_HISTORY_PAGE_POOL_SIZE = 5;
const MAX_HOT_TRANSITION_MESSAGES = 512;
const MAX_TRANSITION_REFERENCES_PER_ROUTE = 64;
const MAX_TRANSITION_REFERENCES_PER_DAY = 512;

function createEmptyGraph() {
  return {
    version: TRACKING_GRAPH_SCHEMA_VERSION,
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
