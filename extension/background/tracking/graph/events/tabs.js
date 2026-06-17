function applyRecordCreatedNavigationTargetFallback(state, event) {
  const sourceNodeId = state.tabState[event.sourceTabId]?.nodeId;

  if (!sourceNodeId) {
    return state;
  }

  state.pendingSources[event.targetTabId] = {
    nodeId: sourceNodeId,
    pageUrl: normalizePageUrlForIndex(state.tabState[event.sourceTabId]?.url || ""),
    createdAt: event.occurredAt,
  };

  return state;
}

function applyRecordTabReplacementFallback(state, event) {
  if (state.tabState[event.replacedTabId]) {
    state.tabState[event.newTabId] = state.tabState[event.replacedTabId];
    delete state.tabState[event.replacedTabId];
  }

  if (state.pendingSources[event.replacedTabId]) {
    state.pendingSources[event.newTabId] = state.pendingSources[event.replacedTabId];
    delete state.pendingSources[event.replacedTabId];
  }

  return state;
}

function applyRemoveTabFallback(state, event) {
  delete state.tabState[event.tabId];
  delete state.pendingSources[event.tabId];
  return state;
}
