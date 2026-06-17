function registerTransitionMessageInBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.sequenceNumber
  ) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, transitionMessage.fromNodeId);
  const bucketLayer = getTransitionMessageBucketLayer(graph);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap =
    bucket[transitionMessage.fromNodeId] ||
    (bucket[transitionMessage.fromNodeId] = {});
  const targetMessages =
    sourceMap[transitionMessage.toNodeId] || (sourceMap[transitionMessage.toNodeId] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

function registerTransitionMessageInDayGroups(graph, transitionMessage) {
  if (!transitionMessage?.sequenceNumber) {
    return;
  }

  const dayKey = buildUtcDayKey(transitionMessage.occurredAt);
  const dayMessages =
    graph.transitionMessagesByDay?.[dayKey] || (graph.transitionMessagesByDay[dayKey] = []);

  if (dayMessages[dayMessages.length - 1] !== transitionMessage.sequenceNumber) {
    dayMessages.push(transitionMessage.sequenceNumber);
  }
}

globalThis.ZeroLatencyTransitionMessageBuckets = {
  registerTransitionMessageInBuckets,
  registerTransitionMessageInDayGroups,
};
