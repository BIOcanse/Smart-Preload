(function () {
  function judgeMessageEnvelope(envelope) {
    if (!envelope || envelope.kind !== "runtime-message") {
      return null;
    }

    if (
      envelope.context?.fromPreloadRuntime === true &&
      ![
        "visit-graph:get-debug-snapshot",
        "extension:open-settings",
        "visit-graph:reset",
      ].includes(envelope.messageType)
    ) {
      return ignoreDecision(envelope.messageType, { ok: true, skipped: true });
    }

    switch (envelope.messageType) {
      case "visit-graph:get-debug-snapshot":
        return allowDecision("debug-snapshot");
      case "extension:open-settings":
        return allowDecision("open-settings");
      case "extension:get-service-state":
        return allowDecision("get-service-state");
      case "extension:set-service-paused":
        return allowDecision("set-service-paused");
      case "visit-graph:reset":
        return allowDecision("reset-graph");
      case "preload:register-candidates":
        return envelope.source.tabId
          ? allowDecision("register-preload-candidates")
          : ignoreDecision(envelope.messageType, {
              ok: true,
              preloadedCount: 0,
              skipped: true,
            });
      case "ai:report-page-digest":
        return envelope.source.tabId
          ? allowAndLearnDecision("report-foreground-page-digest")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "tracking:remember-source-page":
        return envelope.source.tabId
          ? allowAndLearnDecision("remember-source-page")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "tracking:record-link-behavior":
        return envelope.source.tabId && envelope.target.url
          ? allowAndLearnDecision("record-link-behavior")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "navigation:prime-source-page":
        return envelope.source.tabId
          ? allowDecision("navigation-prime-source")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "navigation:record-link-intent":
        return envelope.source.tabId && envelope.target.url
          ? allowDecision("navigation-record-link-intent")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "navigation:resolve-click":
        return envelope.source.tabId && envelope.target.url
          ? interceptDecision("navigation-resolve-click")
          : ignoreDecision(envelope.messageType, { handled: false, action: "skip" });
      case "preload:activate-if-ready":
        return envelope.source.tabId && envelope.target.url
          ? interceptDecision("activate-preloaded-page")
          : ignoreDecision(envelope.messageType, { handled: false });
      default:
        return null;
    }
  }

  function allowDecision(actionKey) {
    return {
      disposition: "allow",
      actionKey,
    };
  }

  function allowAndLearnDecision(actionKey) {
    return {
      disposition: "allow-and-learn",
      actionKey,
    };
  }

  function interceptDecision(actionKey) {
    return {
      disposition: "intercept",
      actionKey,
    };
  }

  function ignoreDecision(messageType, response) {
    return {
      disposition: "ignore",
      actionKey: null,
      reason: `ignored:${messageType}`,
      response,
    };
  }

  globalThis.ZeroLatencyMessageJudge = {
    judgeMessageEnvelope,
  };
})();
