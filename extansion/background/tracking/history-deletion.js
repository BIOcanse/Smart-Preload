(function () {
  function deleteTrackingHistoryRange(trackingState, rawRange) {
    const range = normalizeHistoryDeletionRange(rawRange);
    const state = isPlainObject(trackingState)
      ? trackingState
      : {
          graph: createEmptyGraph(),
          tabState: {},
          pendingSources: {},
        };
    const graph = normalizeTrackingGraph(state.graph);
    const before = buildHistoryDeletionCounts(graph);

    graph.transitionMessages = graph.transitionMessages.filter(
      (transitionMessage) => !isIsoTimestampInRange(transitionMessage.occurredAt, range)
    );
    const deletedTransitionMessages = before.transitionMessageCount - graph.transitionMessages.length;
    const deletedForegroundPages = deleteRecentForegroundPagesInRange(graph, range);
    const deletedPageKeywords = deletePageKeywordsInRange(graph, range);
    const deletedLinkBehaviorRecords = deleteLinkBehaviorRecordsInRange(graph, range);

    rebuildDerivedTrackingHistoryIndexes(graph, {
      previousTransitionSequence: before.transitionSequence,
      updatedAt: new Date().toISOString(),
    });

    state.graph = graph;

    return {
      state,
      result: {
        ok: true,
        range: {
          startDate: range.startDate,
          endDate: range.endDate,
          startAt: range.startAt,
          endAt: range.endAt,
          exclusiveEnd: true,
        },
        deleted: {
          transitionMessages: deletedTransitionMessages,
          recentForegroundPages: deletedForegroundPages,
          pageKeywords: deletedPageKeywords,
          linkBehaviorRecords: deletedLinkBehaviorRecords,
        },
        before,
        after: buildHistoryDeletionCounts(graph),
      },
    };
  }

  function normalizeHistoryDeletionRange(rawRange) {
    const start = parseUtcDateBound(rawRange?.startDate, "startDate");
    const end = parseUtcDateBound(rawRange?.endDate, "endDate");

    if (!start.provided || !end.provided) {
      throw new Error("Select both UTC start date and UTC end date.");
    }

    if (start.ms >= end.ms) {
      throw new Error("UTC start date must be earlier than UTC end date.");
    }

    return {
      startDate: start.date,
      endDate: end.date,
      startAt: new Date(start.ms).toISOString(),
      endAt: new Date(end.ms).toISOString(),
      startMs: start.ms,
      endMs: end.ms,
    };
  }

  function parseUtcDateBound(value, fieldName) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return {
        provided: false,
        ms: null,
        date: null,
      };
    }

    const dateText = String(value).trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);

    if (!match) {
      throw new Error(`Invalid ${fieldName} UTC date.`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsedMs = Date.UTC(year, month - 1, day);
    const parsedDate = new Date(parsedMs);

    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      throw new Error(`Invalid ${fieldName} UTC date.`);
    }

    return {
      provided: true,
      ms: parsedMs,
      date: dateText,
    };
  }

  function isIsoTimestampInRange(value, range) {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }

    const timestampMs = Date.parse(value);

    return (
      Number.isFinite(timestampMs) &&
      timestampMs >= range.startMs &&
      timestampMs < range.endMs
    );
  }

  function deleteRecentForegroundPagesInRange(graph, range) {
    const entries = Array.isArray(graph.recentForegroundPages) ? graph.recentForegroundPages : [];
    graph.recentForegroundPages = entries.filter(
      (entry) =>
        !(
          isIsoTimestampInRange(entry?.activatedAt, range) ||
          isIsoTimestampInRange(entry?.leftForegroundAt, range)
        )
    );
    return entries.length - graph.recentForegroundPages.length;
  }

  function deletePageKeywordsInRange(graph, range) {
    let deletedCount = 0;
    const nextStore = {};

    for (const [pageUrl, entry] of Object.entries(graph.pageKeywordStore || {})) {
      if (isIsoTimestampInRange(entry?.generatedAt, range)) {
        deletedCount += 1;
        continue;
      }

      nextStore[pageUrl] = entry;
    }

    graph.pageKeywordStore = nextStore;
    return deletedCount;
  }

  function deleteLinkBehaviorRecordsInRange(graph, range) {
    let deletedCount = 0;
    const nextStore = {};

    for (const [sourcePageUrl, targetMap] of Object.entries(graph.linkBehaviorStore || {})) {
      if (!isPlainObject(targetMap)) {
        continue;
      }

      const nextTargetMap = {};

      for (const [targetUrl, record] of Object.entries(targetMap)) {
        if (isIsoTimestampInRange(record?.lastSeenAt, range)) {
          deletedCount += 1;
          continue;
        }

        nextTargetMap[targetUrl] = record;
      }

      if (Object.keys(nextTargetMap).length > 0) {
        nextStore[sourcePageUrl] = nextTargetMap;
      }
    }

    graph.linkBehaviorStore = nextStore;
    return deletedCount;
  }

  function rebuildDerivedTrackingHistoryIndexes(
    graph,
    { previousTransitionSequence, updatedAt } = {}
  ) {
    graph.edges = {};
    graph.transitionBuckets = createEmptyTransitionBuckets();
    graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
    graph.pageTransitionBuckets = createEmptyPageTransitionBuckets();
    graph.externalPageTransitionBuckets = createEmptyPageTransitionBuckets();
    graph.intraSitePageTransitionBuckets = createEmptyPageTransitionBuckets();
    graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();
    graph.transitionMessagesByDay = {};
    graph.transitionMessages = normalizeTransitionMessages(graph.transitionMessages || []);
    graph.transitionSequence = Math.max(
      clampNonNegativeInt(previousTransitionSequence, 0),
      getMaxTransitionSequence(graph.transitionMessages)
    );

    for (const transitionMessage of graph.transitionMessages) {
      applyTransitionMessageToIndexes(graph, transitionMessage);
    }

    graph.pageKeywordBuckets = createEmptyPageKeywordBuckets();

    for (const pageKeywordEntry of Object.values(graph.pageKeywordStore || {})) {
      indexPageKeywordEntry(graph, pageKeywordEntry);
    }

    rebuildHistoryPagePoolFromRecentForegroundPages(graph);
    graph.updatedAt = typeof updatedAt === "string" ? updatedAt : new Date().toISOString();
  }

  function rebuildHistoryPagePoolFromRecentForegroundPages(graph) {
    const normalizedHistoryPagePool = normalizeHistoryPagePool(
      [],
      [],
      [],
      graph.recentForegroundPages
    );
    graph.historyPageTitles = normalizedHistoryPagePool.titles;
    graph.historyPageUrls = normalizedHistoryPagePool.urls;
    graph.historyPageTexts = normalizedHistoryPagePool.texts;
  }

  function buildHistoryDeletionCounts(graph) {
    return {
      transitionMessageCount: Array.isArray(graph.transitionMessages)
        ? graph.transitionMessages.length
        : 0,
      edgeCount: Object.keys(graph.edges || {}).length,
      recentForegroundPageCount: Array.isArray(graph.recentForegroundPages)
        ? graph.recentForegroundPages.length
        : 0,
      historyPagePoolSize: Array.isArray(graph.historyPageUrls)
        ? graph.historyPageUrls.length
        : 0,
      pageKeywordCount: Object.keys(graph.pageKeywordStore || {}).length,
      linkBehaviorRecordCount: countLinkBehaviorRecords(graph.linkBehaviorStore),
      transitionSequence: clampNonNegativeInt(graph.transitionSequence, 0),
    };
  }

  function countLinkBehaviorRecords(linkBehaviorStore) {
    return Object.values(linkBehaviorStore || {}).reduce(
      (count, targetMap) =>
        count + (isPlainObject(targetMap) ? Object.keys(targetMap).length : 0),
      0
    );
  }

  globalThis.ZeroLatencyTrackingHistoryDeletion = {
    deleteTrackingHistoryRange,
    normalizeHistoryDeletionRange,
    isIsoTimestampInRange,
    rebuildDerivedTrackingHistoryIndexes,
  };
})();
