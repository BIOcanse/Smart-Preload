const MAX_OPEN_CONTEXT_PAGES = 8;

async function loadAiInterestPageContext(context, graph) {
  const [historyPagePool, recentForegroundPages] = await Promise.all([
    queryTrackingGraphFromGraph(graph, {
      type: "get-history-page-pool",
      limit: 5,
    }),
    queryTrackingGraphFromGraph(graph, {
      type: "get-recent-foreground-pages",
      limit: 8,
    }),
  ]);
  const currentPage = buildCurrentPageAiContextRecord(context);
  const openPages = await collectOpenContextPages({
    graph,
    sourceWindowId: context?.sourceWindowId,
    currentPage,
    historyPagePool,
    recentForegroundPages,
  });

  return {
    historyPagePool,
    recentForegroundPages,
    currentPage,
    openPages,
  };
}

function buildCurrentPageAiContextRecord(context) {
  return {
    pageUrl: normalizePageUrlForIndex(context?.sourceUrl || ""),
    title: typeof context?.currentPageTitle === "string" ? context.currentPageTitle : "",
    textDigest:
      typeof context?.currentPageTextDigest === "string" ? context.currentPageTextDigest : "",
    contentFingerprint:
      typeof context?.currentPageContentFingerprint === "string"
        ? context.currentPageContentFingerprint
        : "",
  };
}

function normalizeRecentForegroundPagePromptRecords(recentForegroundPages) {
  return (Array.isArray(recentForegroundPages) ? recentForegroundPages : [])
    .map((record) => {
      const pageUrl = normalizePageUrlForIndex(record?.pageUrl || "");

      if (!pageUrl) {
        return null;
      }

      return {
        pageUrl,
        title: typeof record?.title === "string" ? record.title : "",
        textDigest: typeof record?.textDigest === "string" ? record.textDigest : "",
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

async function collectOpenContextPages({
  graph,
  sourceWindowId,
  currentPage,
  historyPagePool,
  recentForegroundPages,
}) {
  if (
    !Number.isFinite(Number(sourceWindowId)) ||
    globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "query") !== true
  ) {
    return [];
  }

  const historyPageRecords = globalThis.ZeroLatencyAiKeywords.buildHistoryPagePoolRecords(
    historyPagePool
  );
  const recentForegroundPageRecords = Array.isArray(recentForegroundPages)
    ? recentForegroundPages
    : [];
  const pageContextByUrl = new Map(
    [
      ...recentForegroundPageRecords.map((record) => [
        normalizePageUrlForIndex(record?.pageUrl || ""),
        {
          title: typeof record?.title === "string" ? record.title : "",
          textDigest: typeof record?.textDigest === "string" ? record.textDigest : "",
        },
      ]),
      ...historyPageRecords.map((record) => [
        record.pageUrl,
        {
          title: record.title,
          textDigest: record.textDigest,
        },
      ]),
    ].filter(([pageUrl]) => Boolean(pageUrl))
  );

  try {
    const tabs = await chrome.tabs.query({
      windowId: Number(sourceWindowId),
    });
    const openPages = tabs
      .map((tab) => {
        const pageUrl = normalizePageUrlForIndex(tab?.url || "");

        if (!pageUrl || !isTrackableAndAllowedUrl(pageUrl) || pageUrl === currentPage?.pageUrl) {
          return null;
        }

        const pageContextRecord = pageContextByUrl.get(pageUrl);

        return {
          pageUrl,
          title:
            typeof tab?.title === "string" && tab.title.trim()
              ? tab.title
              : pageContextRecord?.title || "",
          textDigest: pageContextRecord?.textDigest || "",
        };
      })
      .filter(Boolean)
      .slice(0, MAX_OPEN_CONTEXT_PAGES);

    if (!graph || openPages.length === 0) {
      return openPages;
    }

    const pageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
      type: "get-page-keywords-batch",
      pageUrls: openPages.map((page) => page.pageUrl),
    });

    return openPages.map((page) => {
      if (typeof page.textDigest === "string" && page.textDigest.trim()) {
        return page;
      }

      const pageKeywordEntry = pageKeywordsByUrl?.[page.pageUrl];
      const keywordDigest = buildPageKeywordTextDigest(pageKeywordEntry);

      if (!keywordDigest) {
        return page;
      }

      return {
        ...page,
        textDigest: keywordDigest,
      };
    });
  } catch (_error) {
    return [];
  }
}

function buildPageKeywordTextDigest(pageKeywordEntry) {
  if (!pageKeywordEntry) {
    return "";
  }

  const keywordTexts = Array.isArray(pageKeywordEntry.keywords)
    ? pageKeywordEntry.keywords
        .map((keyword) => (typeof keyword?.text === "string" ? keyword.text.trim() : ""))
        .filter(Boolean)
    : [];
  const pageType =
    typeof pageKeywordEntry.pageType === "string" ? pageKeywordEntry.pageType.trim() : "";

  return [pageType, ...keywordTexts].filter(Boolean).join(" ");
}

globalThis.ZeroLatencyAiInterestContext = {
  MAX_OPEN_CONTEXT_PAGES,
  loadAiInterestPageContext,
  buildCurrentPageAiContextRecord,
  normalizeRecentForegroundPagePromptRecords,
  collectOpenContextPages,
  buildPageKeywordTextDigest,
};
