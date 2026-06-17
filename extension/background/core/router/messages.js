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
      case "preload-interaction-status":
      case "report-foreground-page-digest":
      case "record-attention-activity":
        return "side-effect";
      default:
        return "mutation";
    }
  }

  globalThis.ZeroLatencyRouterMessages = {
    createMessageTask,
  };
})();
