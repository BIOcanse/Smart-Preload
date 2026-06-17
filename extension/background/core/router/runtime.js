(function () {
  async function dispatchRuntimeEvent(eventType, payload = {}) {
    const envelope =
      globalThis.ZeroLatencyRuntimeIntercept?.createRuntimeEnvelope(eventType, payload) ?? null;
    const decision =
      globalThis.ZeroLatencyRuntimeJudge?.judgeRuntimeEnvelope(envelope) ?? null;

    if (!decision) {
      return;
    }

    await globalThis.ZeroLatencyRuntimeActions.executeRuntimeDecision(decision, envelope);
  }

  globalThis.ZeroLatencyRouterRuntime = {
    dispatchRuntimeEvent,
  };
})();
