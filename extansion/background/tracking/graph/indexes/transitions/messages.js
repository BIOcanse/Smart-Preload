function applyTransitionMessageToIndexes(graph, transitionMessage) {
  replayTransitionMessageIntoEdgeCounts(graph, transitionMessage);
  registerTransitionMessageInDayGroups(graph, transitionMessage);
  registerTransitionMessageInBuckets(graph, transitionMessage);
  registerTransitionMessageInPageIndexes(graph, transitionMessage);
}
