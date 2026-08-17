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
    // 必须在重建之后：节点的存留判定依赖已经过滤过的 transitionMessages 与
    // recentForegroundPages。此前 graph.nodes 完全没被删除流程触及，
    // 只在被删窗口内访问过的站点会留下完整页面 URL 和访问时间戳。
    const deletedNodes = pruneTrackingNodesAfterHistoryDeletion(graph);

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
          nodes: deletedNodes,
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
