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

  globalThis.ZeroLatencyTrackingHistoryDeletion = {
    deleteTrackingHistoryRange,
    normalizeHistoryDeletionRange,
    isIsoTimestampInRange,
    rebuildDerivedTrackingHistoryIndexes,
  };
})();
