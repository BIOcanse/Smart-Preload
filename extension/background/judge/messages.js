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
        "native-app:update-status",
        "native-app:update-to-version",
        "background-task:snapshot",
        "background-task:get",
        "visit-graph:reset",
        "visit-graph:delete-history-range",
        "visit-graph:export-history",
        "visit-graph:validate-history-import",
        "visit-graph:import-history",
      ].includes(envelope.messageType)
    ) {
      return ignoreDecision(envelope.messageType, { ok: true, skipped: true });
    }

    switch (envelope.messageType) {
      case "visit-graph:get-debug-snapshot":
        return allowDecision("debug-snapshot");
      // 以下四个此前是无条件 allowDecision，而同一个 switch 里所有同级特权消息
      // （native-app:*、background-task:*、visit-graph:delete-history-range /
      // export-history / import-history）都要求 fromExtensionUi。属纵深防御缺口：
      // 当前网页触达不到（无 externally_connectable、无 postMessage 中继，已验证），
      // 但 visit-graph:reset 会**清空整张学习图**——按 invariants 第 7 条，那正是产品
      // 价值本体，不该只靠「网页目前够不着」来保护。
      case "extension:open-settings":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("open-settings")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "extension:get-service-state":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("get-service-state")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "extension:set-service-paused":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("set-service-paused")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "native-app:update-status":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("native-app-update-status")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "native-app:update-to-version":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("native-app-update-to-version")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "background-task:snapshot":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("background-task-snapshot")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "background-task:get":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("background-task-get")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "visit-graph:reset":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("reset-graph")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "visit-graph:delete-history-range":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("delete-history-range")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "visit-graph:export-history":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("export-history")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "visit-graph:validate-history-import":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("validate-history-import")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "visit-graph:import-history":
        return envelope.context?.fromExtensionUi === true
          ? allowDecision("import-history")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "preload:register-candidates":
        return envelope.source.tabId
          ? allowDecision("register-preload-candidates")
          : ignoreDecision(envelope.messageType, {
              ok: true,
              preloadedCount: 0,
              skipped: true,
            });
      case "preload:interaction-status":
        return envelope.source.tabId && envelope.target.url
          ? allowDecision("preload-interaction-status")
          : ignoreDecision(envelope.messageType, { ok: false, preloaded: false });
      case "preload:interaction-start":
        return envelope.source.tabId && envelope.target.url
          ? allowDecision("preload-interaction-start")
          : ignoreDecision(envelope.messageType, { ok: false, skipped: true });
      case "preload:interaction-cancel":
        return envelope.source.tabId
          ? allowDecision("preload-interaction-cancel")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "ai:report-page-digest":
        return envelope.source.tabId
          ? allowAndLearnDecision("report-foreground-page-digest")
          : ignoreDecision(envelope.messageType, { ok: true, skipped: true });
      case "attention:activity":
        return envelope.source.tabId
          ? allowDecision("record-attention-activity")
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
