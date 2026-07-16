(function () {
  const sourceSkip = globalThis.ZeroLatencyMessageActionSourceSkip;
  const attention = globalThis.ZeroLatencyMessageActionAttention;

  async function executeMessageDecision(decision, envelope) {
    if (!decision) {
      return null;
    }

    if (decision.disposition === "ignore") {
      return decision.response ?? { ok: true, skipped: true };
    }

    const message = envelope?.raw?.message;
    const sender = envelope?.raw?.sender;
    const skippedResponse = await sourceSkip.shouldSkipMessageForExcludedSource(
      decision.actionKey,
      sender
    );

    if (skippedResponse) {
      return skippedResponse;
    }

    switch (decision.actionKey) {
      case "debug-snapshot":
        return globalThis.ZeroLatencyCoreMessages.handleDebugSnapshot(message);
      case "open-settings":
        return globalThis.ZeroLatencyCoreMessages.handleOpenSettings();
      case "get-service-state":
        return globalThis.ZeroLatencyCoreMessages.handleGetServiceState();
      case "set-service-paused":
        return globalThis.ZeroLatencyCoreMessages.handleSetServicePaused(message);
      case "native-app-update-status":
        return globalThis.ZeroLatencyCoreMessages.handleNativeAppUpdateStatus(message);
      case "native-app-update-to-version":
        return globalThis.ZeroLatencyCoreMessages.handleNativeAppUpdateToVersion(message);
      case "background-task-snapshot":
        return globalThis.ZeroLatencyCoreMessages.handleBackgroundTaskSnapshot(message);
      case "background-task-get":
        return globalThis.ZeroLatencyCoreMessages.handleBackgroundTaskGet(message);
      case "reset-graph":
        return globalThis.ZeroLatencyCoreMessages.handleReset();
      case "delete-history-range":
        return globalThis.ZeroLatencyCoreMessages.handleDeleteHistoryRange(message);
      case "export-history":
        return globalThis.ZeroLatencyCoreMessages.handleExportHistory();
      case "validate-history-import":
        return globalThis.ZeroLatencyCoreMessages.handleValidateHistoryImport(message);
      case "import-history":
        return globalThis.ZeroLatencyCoreMessages.handleImportHistory(message);
      case "register-preload-candidates":
        attention.recordCandidateScanAttention(message, sender);
        return globalThis.ZeroLatencyPreloadRuntimeManager.registerCandidates(message, sender);
      case "preload-interaction-status":
        return globalThis.ZeroLatencyPreloadRuntimeManager.getInteractionPreloadStatus(
          message,
          sender
        );
      case "preload-interaction-start":
        return globalThis.ZeroLatencyPreloadRuntimeManager.startInteractionPreload(
          message,
          sender
        );
      case "preload-interaction-cancel":
        return globalThis.ZeroLatencyPreloadRuntimeManager.cancelInteractionPreloads(
          message,
          sender
        );
      case "report-foreground-page-digest":
        attention.recordForegroundDigestAttention(message, sender);
        return globalThis.ZeroLatencyLearning.handleForegroundPageDigest(message, sender);
      case "record-attention-activity":
        return attention.recordAttentionActivity(message, sender);
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
