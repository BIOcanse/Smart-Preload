function queryTrackingGraphFallback(state, query) {
  const graph = state?.graph;

  switch (query?.type) {
    case "get-transition-bucket":
      return queryTransitionBucketFallback(graph, query);
    case "get-transition-message-bucket":
      return queryTransitionMessageBucketFallback(graph, query);
    case "get-transition-message":
      return queryTransitionMessageFallback(graph, query);
    case "get-recent-transition-messages":
      return queryRecentTransitionMessagesFallback(graph, query);
    case "get-candidate-transition-metrics-batch":
      return queryCandidateTransitionMetricsBatchFallback(graph, query);
    case "get-page-keywords":
      return queryPageKeywordsFallback(graph, query);
    case "get-page-keywords-batch":
      return queryPageKeywordsBatchFallback(graph, query);
    case "get-recent-foreground-pages":
      return queryRecentForegroundPagesFallback(graph, query);
    case "get-history-page-pool":
      return queryHistoryPagePoolFallback(graph, query);
    default:
      throw new Error(`Unsupported visit graph query type: ${query?.type}`);
  }
}
