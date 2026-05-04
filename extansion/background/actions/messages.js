(function () {
  async function executeMessageDecision(decision, envelope) {
    if (!decision) {
      return null;
    }

    if (decision.disposition === "ignore") {
      return decision.response ?? { ok: true, skipped: true };
    }

    const message = envelope?.raw?.message;
    const sender = envelope?.raw?.sender;

    switch (decision.actionKey) {
      case "debug-snapshot":
        return globalThis.ZeroLatencyCoreMessages.handleDebugSnapshot(message);
      case "open-settings":
        return globalThis.ZeroLatencyCoreMessages.handleOpenSettings();
      case "get-service-state":
        return globalThis.ZeroLatencyCoreMessages.handleGetServiceState();
      case "set-service-paused":
        return globalThis.ZeroLatencyCoreMessages.handleSetServicePaused(message);
      case "reset-graph":
        return globalThis.ZeroLatencyCoreMessages.handleReset();
      case "register-preload-candidates":
        return globalThis.ZeroLatencyPreloadRuntimeManager.registerCandidates(message, sender);
      case "report-foreground-page-digest":
        return globalThis.ZeroLatencyLearning.handleForegroundPageDigest(message, sender);
      case "remember-source-page":
        return globalThis.ZeroLatencyLearning.rememberSourcePage(message, sender);
      case "record-link-behavior":
        return globalThis.ZeroLatencyLearning.recordLinkBehavior(message, sender);
      case "navigation-prime-source":
        return globalThis.ZeroLatencyNavigationManager.primeSourcePage(message, sender);
      case "navigation-record-link-intent":
        return globalThis.ZeroLatencyNavigationManager.recordLinkIntent(message, sender);
      case "navigation-resolve-click":
        return globalThis.ZeroLatencyNavigationManager.resolveClickNavigation(message, sender);
      case "activate-preloaded-page":
        return globalThis.ZeroLatencyPreloadRuntimeManager.activateIfReady(message, sender);
      default:
        return { ok: true, skipped: true };
    }
  }

  globalThis.ZeroLatencyMessageActions = {
    executeMessageDecision,
  };
})();
