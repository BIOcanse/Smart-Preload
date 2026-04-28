function applyRecordForegroundPageFallback(state, event) {
  const pageUrl = normalizePageUrlForIndex(event.pageUrl || "");

  if (!pageUrl) {
    return state;
  }

  const nextEntry = {
    tabId: Number(event.tabId),
    windowId: Number(event.windowId),
    nodeId: typeof event.nodeId === "string" ? event.nodeId : "",
    pageUrl,
    title: typeof event.title === "string" ? event.title : "",
    textDigest: typeof event.textDigest === "string" ? event.textDigest : "",
    contentFingerprint:
      typeof event.contentFingerprint === "string" ? event.contentFingerprint : "",
    activatedAt: typeof event.activatedAt === "string" ? event.activatedAt : event.occurredAt,
    leftForegroundAt:
      typeof event.leftForegroundAt === "string" ? event.leftForegroundAt : null,
    wasPreloadedBeforeForeground: event.wasPreloadedBeforeForeground === true,
  };
  const existingEntries = Array.isArray(state.graph.recentForegroundPages)
    ? state.graph.recentForegroundPages
    : [];

  state.graph.recentForegroundPages = [
    nextEntry,
    ...existingEntries.filter((entry) => entry.pageUrl !== pageUrl),
  ].slice(0, 6);
  prependHistoryPagePoolEntry(state.graph, {
    title: nextEntry.title,
    pageUrl: nextEntry.pageUrl,
    text: nextEntry.textDigest,
  });
  state.graph.updatedAt = event.occurredAt;
  return state;
}

function applyUpsertPageKeywordsFallback(state, event) {
  const pageUrl = normalizePageUrlForIndex(event.pageUrl || "");

  if (!pageUrl) {
    return state;
  }

  const entry = normalizePageKeywordEntry(pageUrl, {
    pageUrl,
    siteNodeId: event.siteNodeId,
    title: event.title,
    keywords: event.keywords,
    pageType: event.pageType,
    generatedAt: event.generatedAt,
    expiresAt: event.expiresAt,
    modelId: event.modelId,
    contentFingerprint: event.contentFingerprint,
  });

  if (!entry) {
    return state;
  }

  state.graph.pageKeywordStore[entry.pageUrl] = entry;
  state.graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();

  for (const pageKeywordEntry of Object.values(state.graph.pageKeywordStore)) {
    indexPageKeywordEntry(state.graph, pageKeywordEntry);
  }

  state.graph.updatedAt = event.generatedAt || event.occurredAt || new Date().toISOString();
  return state;
}

function applyRecordLinkBehaviorFallback(state, event) {
  const sourcePageUrl = normalizePageUrlForIndex(event.sourcePageUrl || "");
  const targetUrl = normalizePageUrlForIndex(event.targetUrl || "");

  if (!sourcePageUrl || !targetUrl) {
    return state;
  }

  const sourceMap =
    state.graph.linkBehaviorStore[sourcePageUrl] ||
    (state.graph.linkBehaviorStore[sourcePageUrl] = {});
  const previousRecord = sourceMap[targetUrl] || {
    selfCount: 0,
    blankCount: 0,
    lastTargetHint: "_self",
    lastSeenAt: null,
  };
  const nextTargetHint = event.targetHint === "_blank" ? "_blank" : "_self";

  sourceMap[targetUrl] = {
    selfCount:
      previousRecord.selfCount + (nextTargetHint === "_self" ? 1 : 0),
    blankCount:
      previousRecord.blankCount + (nextTargetHint === "_blank" ? 1 : 0),
    lastTargetHint: nextTargetHint,
    lastSeenAt: typeof event.occurredAt === "string" ? event.occurredAt : new Date().toISOString(),
  };
  state.graph.updatedAt = sourceMap[targetUrl].lastSeenAt;
  return state;
}

function prependHistoryPagePoolEntry(graph, entry) {
  const pageUrl = normalizePageUrlForIndex(entry?.pageUrl || "");

  if (!pageUrl) {
    return;
  }

  const historyEntries = [];
  const existingTitles = Array.isArray(graph.historyPageTitles) ? graph.historyPageTitles : [];
  const existingUrls = Array.isArray(graph.historyPageUrls) ? graph.historyPageUrls : [];
  const existingTexts = Array.isArray(graph.historyPageTexts) ? graph.historyPageTexts : [];
  const maxExistingLength = Math.max(existingTitles.length, existingUrls.length, existingTexts.length);

  historyEntries.push({
    title: typeof entry?.title === "string" ? entry.title : "",
    pageUrl,
    text: typeof entry?.text === "string" ? entry.text : "",
  });

  for (let index = 0; index < maxExistingLength; index += 1) {
    const existingPageUrl = normalizePageUrlForIndex(existingUrls[index] || "");

    if (!existingPageUrl || existingPageUrl === pageUrl) {
      continue;
    }

    historyEntries.push({
      title: typeof existingTitles[index] === "string" ? existingTitles[index] : "",
      pageUrl: existingPageUrl,
      text: typeof existingTexts[index] === "string" ? existingTexts[index] : "",
    });

    if (historyEntries.length >= MAX_HISTORY_PAGE_POOL_SIZE) {
      break;
    }
  }

  graph.historyPageTitles = historyEntries.map((historyEntry) => historyEntry.title);
  graph.historyPageUrls = historyEntries.map((historyEntry) => historyEntry.pageUrl);
  graph.historyPageTexts = historyEntries.map((historyEntry) => historyEntry.text);
}
