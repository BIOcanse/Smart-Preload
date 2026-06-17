(function () {
  function createNavigationEnvelope(eventType, payload = {}) {
    return {
      kind: "browser-event",
      phase: "post",
      eventType,
      source: buildNavigationSource(payload),
      target: buildNavigationTarget(payload),
      context: buildNavigationContext(eventType, payload),
      raw: payload,
    };
  }

  function buildNavigationSource(payload) {
    return {
      tabId:
        Number.isFinite(payload?.tabId) ? payload.tabId : Number.isFinite(payload?.sourceTabId)
          ? payload.sourceTabId
          : null,
      windowId: Number.isFinite(payload?.windowId) ? payload.windowId : null,
      frameId: Number.isFinite(payload?.frameId) ? payload.frameId : null,
      pageUrl: typeof payload?.url === "string" ? payload.url : null,
    };
  }

  function buildNavigationTarget(payload) {
    return {
      tabId:
        Number.isFinite(payload?.targetTabId) ? payload.targetTabId : Number.isFinite(payload?.tabId)
          ? payload.tabId
          : null,
      url: typeof payload?.url === "string" ? payload.url : null,
      alarmName: typeof payload?.name === "string" ? payload.name : null,
    };
  }

  function buildNavigationContext(eventType, payload) {
    return {
      frameId: Number.isFinite(payload?.frameId) ? payload.frameId : null,
      hasUrl: typeof payload?.url === "string" && payload.url.length > 0,
      transitionType:
        typeof payload?.transitionType === "string" ? payload.transitionType : null,
      sourceEvent:
        eventType === "committed"
          ? "committed"
          : eventType === "history-state-updated"
            ? "history-state-updated"
            : null,
      hasTabStatus: Boolean(payload?.changeInfo?.status || payload?.changeInfo?.url),
    };
  }

  globalThis.ZeroLatencyNavigationIntercept = {
    createNavigationEnvelope,
  };
})();
