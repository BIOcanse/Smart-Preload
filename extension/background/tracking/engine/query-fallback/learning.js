function queryPageKeywordsFallback(graph, query) {
  const pageUrl = normalizePageUrlForIndex(query?.pageUrl || "");

  if (!graph || !pageUrl) {
    return null;
  }

  return getPageKeywordEntry(graph, pageUrl);
}

function queryRecentForegroundPagesFallback(graph, query) {
  if (!graph) {
    return [];
  }

  return getRecentForegroundPages(graph, query?.limit ?? 6);
}

function queryHistoryPagePoolFallback(graph, query) {
  if (!graph) {
    return {
      titles: [],
      urls: [],
      texts: [],
    };
  }

  return getHistoryPagePool(graph, query?.limit ?? 5);
}

function queryPageKeywordsBatchFallback(graph, query) {
  if (!graph) {
    return {};
  }

  return getPageKeywordEntriesByUrl(graph, query?.pageUrls ?? []);
}
