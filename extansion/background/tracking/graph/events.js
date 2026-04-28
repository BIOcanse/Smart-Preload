function applyTrackingEventFallback(state, event) {
  switch (event.type) {
    case "set-current-page":
      return applySetCurrentPageFallback(state, event);
    case "record-visit":
      return applyRecordVisitFallback(state, event);
    case "record-foreground-page":
      return applyRecordForegroundPageFallback(state, event);
    case "upsert-page-keywords":
      return applyUpsertPageKeywordsFallback(state, event);
    case "record-link-behavior":
      return applyRecordLinkBehaviorFallback(state, event);
    case "record-created-navigation-target":
      return applyRecordCreatedNavigationTargetFallback(state, event);
    case "record-tab-replacement":
      return applyRecordTabReplacementFallback(state, event);
    case "remove-tab":
      return applyRemoveTabFallback(state, event);
    default:
      throw new Error(`Unsupported visit graph event type: ${event.type}`);
  }
}

(function () {
  globalThis.ZeroLatencyTrackingGraphEvents = {
    applyTrackingEventFallback,
    applySetCurrentPageFallback,
    applyRecordVisitFallback,
    applyRecordForegroundPageFallback,
    applyUpsertPageKeywordsFallback,
    applyRecordLinkBehaviorFallback,
    applyRecordCreatedNavigationTargetFallback,
    applyRecordTabReplacementFallback,
    applyRemoveTabFallback,
    upsertNodeFallback,
    upsertEdgeFallback,
  };
})();
