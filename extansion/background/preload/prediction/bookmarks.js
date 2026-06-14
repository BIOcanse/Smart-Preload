const BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH = "startupGoogleSearch";
const BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB = "newGoogleSearchTab";
const BOOKMARK_PRELOAD_CACHE_TTL_MS = 5_000;

let cachedBookmarkEntries = null;
let cachedBookmarkEntriesExpiresAt = 0;

async function buildGoogleBookmarkPreloadTargets({
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  graph,
  settings,
}) {
  const context = await resolveGoogleBookmarkPreloadTargetContext({
    settings,
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!context) {
    return [];
  }

  const rankedEntries = rankGoogleBookmarkPreloadEntries(
    context.bookmarkEntries,
    graph,
    context.bucketKey
  );
  const selectedEntries = filterGoogleBookmarkPreloadEntriesByRankRule(
    rankedEntries,
    settings
  );

  recordGoogleBookmarkPreloadTargetDiagnostic({
    sourceUrl,
    bucketKey: context.bucketKey,
    bookmarkEntries: context.bookmarkEntries,
    rankedEntries,
    selectedEntries,
  });

  return selectedEntries.map((entry) =>
    buildGoogleBookmarkPreloadTarget({
      entry,
      bucketKey: context.bucketKey,
      settings,
    })
  );
}

async function resolveGoogleBookmarkPreloadTargetContext({
  settings,
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  if (!isGoogleBookmarkPreloadEnabled(settings, sourceUrl)) {
    return null;
  }

  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("bookmarks", "getTree") !== true) {
    recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.skip", {
      reason: "bookmarks-api-unavailable",
      sourceUrl,
    });
    return null;
  }

  const bucketKey = await resolveGoogleBookmarkPreloadBucketKey({
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!bucketKey) {
    return null;
  }

  const bookmarkEntries = await collectChromeBookmarkEntries(sourceUrl);

  if (bookmarkEntries.length === 0) {
    return null;
  }

  return {
    bucketKey,
    bookmarkEntries,
  };
}

function rankGoogleBookmarkPreloadEntries(bookmarkEntries, graph, bucketKey) {
  return bookmarkEntries
    .map((entry) => ({
      ...entry,
      count: getBookmarkPreloadCount(graph, bucketKey, entry.targetPageUrl),
    }))
    .sort(compareBookmarkPreloadEntryPriority)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function filterGoogleBookmarkPreloadEntriesByRankRule(rankedEntries, settings) {
  const bookmarkRuleCardState = getGoogleBookmarkPreloadRuleCardState(settings);

  if (!settingsApi.isRuleCardEnabled(bookmarkRuleCardState)) {
    return [];
  }

  return (Array.isArray(rankedEntries) ? rankedEntries : []).filter((entry) =>
    settingsApi.evaluateRuleCardMetric(
      bookmarkRuleCardState,
      clampNonNegativeInt(entry?.rank, 0)
    ) &&
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
      entry?.url,
      settings
    ) !== true
  );
}

function recordGoogleBookmarkPreloadTargetDiagnostic({
  sourceUrl,
  bucketKey,
  bookmarkEntries,
  rankedEntries,
  selectedEntries,
}) {
  recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.targets", {
    sourceUrl,
    bucketKey,
    bookmarkCount: bookmarkEntries.length,
    rankedCount: rankedEntries.length,
    selectedCount: selectedEntries.length,
    topBookmarks: selectedEntries.slice(0, 8).map((entry) => ({
      rank: entry.rank,
      url: entry.url,
      count: entry.count,
      title: entry.title,
    })),
  });
}

function buildGoogleBookmarkPreloadTarget({
  entry,
  bucketKey,
  settings,
}) {
  const targetNodeId = buildNodeSeed(entry.url).nodeId;

  return {
    url: entry.url,
    nodeId: targetNodeId,
    score: 0,
    scoreBreakdown: null,
    transitionMetrics: null,
    targetHint: "_self",
    aiKeywordMatch: null,
    bookmarkPreload: {
      bucketKey,
      count: entry.count,
      rank: entry.rank,
      title: entry.title,
    },
    siteSelection: null,
    strategy:
      globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.resolveHiddenTabStrategyForNativeOnlyMode?.(
        "hidden-tab",
        settings
      ) ?? "hidden-tab",
  };
}

function isGoogleBookmarkPreloadEnabled(settings, sourceUrl) {
  return (
    settingsApi.isRuleCardEnabled(getGoogleBookmarkPreloadRuleCardState(settings)) &&
    isGoogleSearchPageForBookmarkPreload(sourceUrl)
  );
}

function getGoogleBookmarkPreloadRuleCardState(settings) {
  return settings?.layout?.ruleCards?.items?.googleBookmarkRank ?? null;
}

async function resolveGoogleBookmarkPreloadBucketKey({
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  if (!isGoogleSearchPageForBookmarkPreload(sourceUrl)) {
    return null;
  }

  const serviceState = await ensureGoogleBookmarkStartupAnchor({
    serviceState: await loadServiceState(),
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });
  return resolveGoogleBookmarkPreloadBucketKeyFromServiceState({
    serviceState,
    sourceTabId,
    sourceWindowId,
  });
}

function resolveGoogleBookmarkPreloadBucketKeyFromServiceState({
  serviceState,
  sourceTabId,
  sourceWindowId,
}) {
  const bookmarkState = normalizeBookmarkPreloadingServiceState(
    serviceState?.bookmarkPreloading
  );
  const normalizedSourceTabId = normalizePositiveInteger(sourceTabId, null);
  const normalizedSourceWindowId = normalizePositiveInteger(sourceWindowId, null);

  if (
    normalizedSourceTabId !== null &&
    normalizedSourceTabId === bookmarkState.startupGoogleSearchTabId &&
    (normalizedSourceWindowId === null ||
      normalizedSourceWindowId === bookmarkState.startupGoogleSearchWindowId)
  ) {
    return BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH;
  }

  return BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB;
}

async function ensureGoogleBookmarkStartupAnchor({
  serviceState,
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  const normalizedServiceState = normalizeServiceState(serviceState);
  const bookmarkState = normalizeBookmarkPreloadingServiceState(
    normalizedServiceState.bookmarkPreloading
  );

  if (
    bookmarkState.startupGoogleSearchTabId !== null &&
    bookmarkState.startupGoogleSearchWindowId !== null
  ) {
    return normalizedServiceState;
  }

  if (!isGoogleSearchPageForBookmarkPreload(sourceUrl)) {
    return normalizedServiceState;
  }

  const normalizedSourceTabId = normalizePositiveInteger(sourceTabId, null);
  let normalizedSourceWindowId = normalizePositiveInteger(sourceWindowId, null);

  if (normalizedSourceTabId === null) {
    return normalizedServiceState;
  }

  if (normalizedSourceWindowId === null) {
    const sourceTab = await getTabMaybe(normalizedSourceTabId);
    normalizedSourceWindowId = normalizePositiveInteger(sourceTab?.windowId, null);
  }

  if (normalizedSourceWindowId === null) {
    return normalizedServiceState;
  }

  normalizedServiceState.bookmarkPreloading = {
    startupGoogleSearchTabId: normalizedSourceTabId,
    startupGoogleSearchWindowId: normalizedSourceWindowId,
  };
  normalizedServiceState.updatedAt = new Date().toISOString();
  await saveServiceState(normalizedServiceState);
  recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.startup-anchor.saved", {
    sourceTabId: normalizedSourceTabId,
    sourceWindowId: normalizedSourceWindowId,
    sourceUrl,
  });
  return normalizedServiceState;
}

async function recordGoogleBookmarkPreloadNavigationIfNeeded(
  trackingState,
  {
    sourceTabId,
    sourceWindowId,
    sourcePageUrl,
    targetUrl,
    transitionType,
    occurredAt,
    settings,
  }
) {
  if (transitionType !== "auto_bookmark") {
    return false;
  }

  if (!settingsApi.isRuleCardEnabled(getGoogleBookmarkPreloadRuleCardState(settings))) {
    return false;
  }

  if (!isGoogleSearchPageForBookmarkPreload(sourcePageUrl)) {
    return false;
  }

  const targetPageUrl = normalizePageUrlForIndex(targetUrl || "");

  if (!targetPageUrl) {
    return false;
  }

  const bucketKey = await resolveGoogleBookmarkPreloadBucketKey({
    sourceUrl: sourcePageUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!bucketKey) {
    return false;
  }

  const didRecord = incrementBookmarkPreloadCount(
    trackingState?.graph,
    bucketKey,
    targetPageUrl
  );

  if (!didRecord) {
    return false;
  }

  trackingState.graph.updatedAt = occurredAt;
  recordGoogleBookmarkPreloadDiagnostic("tracking.google-bookmark.saved", {
    sourceTabId,
    sourcePageUrl,
    targetPageUrl,
    bucketKey,
    count: getBookmarkPreloadCount(trackingState.graph, bucketKey, targetPageUrl),
  });
  return true;
}

async function collectChromeBookmarkEntries(sourceUrl) {
  const now = Date.now();

  if (cachedBookmarkEntries && cachedBookmarkEntriesExpiresAt > now) {
    return cachedBookmarkEntries;
  }

  try {
    const tree = await chrome.bookmarks.getTree();
    const entriesByUrl = new Map();
    let bookmarkIndex = 0;

    for (const node of Array.isArray(tree) ? tree : []) {
      collectChromeBookmarkNodeEntries(node, sourceUrl, entriesByUrl, () => {
        bookmarkIndex += 1;
        return bookmarkIndex;
      });
    }

    cachedBookmarkEntries = [...entriesByUrl.values()];
    cachedBookmarkEntriesExpiresAt = now + BOOKMARK_PRELOAD_CACHE_TTL_MS;
    return cachedBookmarkEntries;
  } catch (error) {
    recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.error", {
      reason: "collect-failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function collectChromeBookmarkNodeEntries(node, sourceUrl, entriesByUrl, nextIndex) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (typeof node.url === "string" && node.url) {
    const candidateUrl = normalizeNavigableUrl(node.url, sourceUrl);
    const targetPageUrl = normalizePageUrlForIndex(candidateUrl || "");

    if (candidateUrl && targetPageUrl && !isExcludedTrackingPage(candidateUrl)) {
      const existingEntry = entriesByUrl.get(targetPageUrl);
      const nextEntry = {
        url: candidateUrl,
        targetPageUrl,
        title: normalizeBookmarkTitle(node.title, candidateUrl),
        bookmarkIndex: nextIndex(),
      };

      entriesByUrl.set(
        targetPageUrl,
        existingEntry
          ? selectBetterBookmarkPreloadEntry(existingEntry, nextEntry)
          : nextEntry
      );
    }
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectChromeBookmarkNodeEntries(child, sourceUrl, entriesByUrl, nextIndex);
  }
}

function selectBetterBookmarkPreloadEntry(existingEntry, nextEntry) {
  if (!existingEntry.title && nextEntry.title) {
    return nextEntry;
  }

  if (nextEntry.title.length > existingEntry.title.length) {
    return {
      ...nextEntry,
      bookmarkIndex: Math.min(existingEntry.bookmarkIndex, nextEntry.bookmarkIndex),
    };
  }

  return existingEntry;
}

function normalizeBookmarkTitle(rawTitle, fallbackUrl) {
  const normalizedTitle = String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  if (normalizedTitle) {
    return normalizedTitle;
  }

  return derivePageLabel(fallbackUrl);
}

function compareBookmarkPreloadEntryPriority(left, right) {
  if (right.count !== left.count) {
    return right.count - left.count;
  }

  return left.bookmarkIndex - right.bookmarkIndex;
}

function getBookmarkPreloadCount(graph, bucketKey, targetPageUrl) {
  if (!bucketKey || !targetPageUrl) {
    return 0;
  }

  return clampNonNegativeInt(graph?.bookmarkPreloadBuckets?.[bucketKey]?.[targetPageUrl], 0);
}

function incrementBookmarkPreloadCount(graph, bucketKey, targetPageUrl) {
  if (!isPlainObject(graph) || !bucketKey || !targetPageUrl) {
    return false;
  }

  graph.bookmarkPreloadBuckets = normalizeBookmarkPreloadBuckets(
    graph.bookmarkPreloadBuckets
  );

  if (!isPlainObject(graph.bookmarkPreloadBuckets[bucketKey])) {
    graph.bookmarkPreloadBuckets[bucketKey] = {};
  }

  graph.bookmarkPreloadBuckets[bucketKey][targetPageUrl] =
    clampNonNegativeInt(graph.bookmarkPreloadBuckets[bucketKey][targetPageUrl], 0) + 1;
  return true;
}

function isGoogleSearchPageForBookmarkPreload(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (!isGoogleSearchPageHost(parsedUrl.hostname)) {
      return false;
    }

    if (parsedUrl.pathname === "/search") {
      return true;
    }

    return parsedUrl.pathname === "/" || parsedUrl.pathname === "/webhp";
  } catch (_error) {
    return false;
  }
}

function isGoogleSearchPageHost(hostname) {
  const normalizedHostname = String(hostname || "").toLowerCase();

  return (
    normalizedHostname === "google.com" ||
    normalizedHostname === "www.google.com" ||
    normalizedHostname.startsWith("google.") ||
    normalizedHostname.startsWith("www.google.")
  );
}

function recordGoogleBookmarkPreloadDiagnostic(eventName, payload) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  globalThis.ZeroLatencyDiagnostics?.record?.(eventName, payload);
}
