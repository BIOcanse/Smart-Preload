(function () {
  async function dispatchNavigationEvent(eventType, payload) {
    const envelope =
      globalThis.ZeroLatencyNavigationIntercept?.createNavigationEnvelope(eventType, payload) ??
      null;
    const decision =
      globalThis.ZeroLatencyNavigationJudge?.judgeNavigationEnvelope(envelope) ?? null;

    if (!decision) {
      return;
    }

    await globalThis.ZeroLatencyNavigationActions.executeNavigationDecision(
      decision,
      envelope
    );
  }

  globalThis.ZeroLatencyRouterNavigation = {
    dispatchNavigationEvent,
  };
})();
