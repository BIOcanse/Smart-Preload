(function () {
  function createDiagnosticEvent({
    eventName,
    payload = {},
    metadata = {},
    sanitizer,
    sequence,
    sessionId,
  }) {
    const normalizedEventName =
      typeof eventName === "string" && eventName.trim() ? eventName.trim() : "unknown";

    return {
      sequence,
      sessionId,
      flowId: sanitizer.normalizeOptionalString(metadata.flowId ?? payload?.flowId),
      category: sanitizer.normalizeEventCategory(normalizedEventName),
      eventName: normalizedEventName,
      level: sanitizer.normalizeLevel(metadata.level ?? payload?.level),
      recordedAt: new Date().toISOString(),
      tabId: sanitizer.normalizeOptionalInteger(metadata.tabId ?? payload?.tabId),
      windowId: sanitizer.normalizeOptionalInteger(metadata.windowId ?? payload?.windowId),
      sourceTabId: sanitizer.normalizeOptionalInteger(metadata.sourceTabId ?? payload?.sourceTabId),
      sourceWindowId: sanitizer.normalizeOptionalInteger(
        metadata.sourceWindowId ?? payload?.sourceWindowId
      ),
      url: sanitizer.normalizeOptionalString(metadata.url ?? payload?.url ?? payload?.pageUrl),
      nodeId: sanitizer.normalizeOptionalString(metadata.nodeId ?? payload?.nodeId),
      payload: sanitizer.sanitizeDiagnosticPayload(payload),
    };
  }

  function createDiagnosticDisabledEvent({ sequence, sessionId }) {
    return {
      sequence,
      sessionId,
      flowId: null,
      category: "diagnostics",
      eventName: "diagnostics.disabled",
      level: "info",
      recordedAt: new Date().toISOString(),
      tabId: null,
      windowId: null,
      sourceTabId: null,
      sourceWindowId: null,
      url: null,
      nodeId: null,
      payload: {
        sessionId,
      },
    };
  }

  globalThis.ZeroLatencyDiagnosticLoggerEvent = {
    createDiagnosticEvent,
    createDiagnosticDisabledEvent,
  };
})();
