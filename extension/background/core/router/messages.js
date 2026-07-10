(function () {
  function createMessageTask(message, sender) {
    const envelope =
      globalThis.ZeroLatencyMessageIntercept?.createMessageEnvelope(message, sender) ?? null;
    const decision =
      globalThis.ZeroLatencyMessageJudge?.judgeMessageEnvelope(envelope) ?? null;

    if (!decision) {
      return null;
    }

    return {
      queueMode: resolveMessageQueueMode(decision.actionKey),
      queueKey: resolveMessageQueueKey(decision.actionKey, envelope),
      task: () => globalThis.ZeroLatencyMessageActions.executeMessageDecision(decision, envelope),
    };
  }

  function resolveMessageQueueMode(actionKey) {
    switch (actionKey) {
      case "debug-snapshot":
      case "open-settings":
      case "get-service-state":
      case "native-app-update-status":
      case "background-task-snapshot":
      case "background-task-get":
        return "direct";
      case "register-preload-candidates":
        return "candidate";
      case "record-attention-activity":
        return "direct";
      case "preload-interaction-status":
      case "preload-interaction-start":
      case "preload-interaction-cancel":
      case "navigation-resolve-click":
      case "activate-preloaded-page":
        return "interaction";
      case "report-foreground-page-digest":
        return "ai";
      default:
        return "mutation";
    }
  }

  function resolveMessageQueueKey(actionKey, envelope) {
    const sourceTabId = Number(envelope?.source?.tabId);

    if (actionKey === "register-preload-candidates") {
      return Number.isInteger(sourceTabId) && sourceTabId > 0
        ? `candidate:${sourceTabId}`
        : "candidate:unknown";
    }

    if (actionKey === "record-attention-activity") {
      return Number.isInteger(sourceTabId) && sourceTabId > 0
        ? `attention:${sourceTabId}`
        : "attention:unknown";
    }

    if (actionKey === "report-foreground-page-digest") {
      const sourcePageUrl =
        typeof envelope?.target?.pageUrl === "string" && envelope.target.pageUrl
          ? envelope.target.pageUrl
          : typeof envelope?.source?.pageUrl === "string"
            ? envelope.source.pageUrl
            : "unknown";
      const tabKey =
        Number.isInteger(sourceTabId) && sourceTabId > 0 ? sourceTabId : "unknown";
      return `ai:${tabKey}:${sourcePageUrl}`;
    }

    return null;
  }

  globalThis.ZeroLatencyRouterMessages = {
    createMessageTask,
  };
})();
