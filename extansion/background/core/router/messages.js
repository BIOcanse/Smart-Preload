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
      case "register-preload-candidates":
      case "report-foreground-page-digest":
        return "side-effect";
      default:
        return "mutation";
    }
  }

  globalThis.ZeroLatencyRouterMessages = {
    createMessageTask,
  };
})();
