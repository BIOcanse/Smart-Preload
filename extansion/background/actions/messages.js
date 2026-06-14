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

    if (await shouldSkipMessageForExcludedIncognitoSource(decision.actionKey, sender)) {
      return {
        ok: true,
        skipped: true,
        reason: "incognito-excluded",
      };
    }

    if (await shouldSkipMessageForProxySkippedSource(decision.actionKey, sender)) {
      return {
        ok: true,
        skipped: true,
        reason: "proxy-skip",
      };
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
      case "reset-graph":
        return globalThis.ZeroLatencyCoreMessages.handleReset();
      case "delete-history-range":
        return globalThis.ZeroLatencyCoreMessages.handleDeleteHistoryRange(message);
      case "register-preload-candidates":
        void globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
          sender,
          "preload-candidate-scan",
          {
            activity: message?.attentionActivity ?? null,
          }
        )?.catch?.((error) => {
          console.debug("Failed to record preload candidate attention.", error);
        });
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
        void globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
          sender,
          "foreground-page-digest",
          {
            activity: message?.attentionActivity ?? null,
          }
        )?.catch?.((error) => {
          console.debug("Failed to record foreground digest attention.", error);
        });
        return globalThis.ZeroLatencyLearning.handleForegroundPageDigest(message, sender);
      case "record-attention-activity":
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
          sender,
          "content-attention-activity",
          {
            activity: message?.activity ?? message,
          }
        );
        return { ok: true };
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

  async function shouldSkipMessageForExcludedIncognitoSource(actionKey, sender) {
    if (!shouldApplyIncognitoSourceSkipToMessageAction(actionKey)) {
      return false;
    }

    const sourceTab = sender?.tab ?? null;

    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        sourceTab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        getEffectiveExtensionSettings(),
        {
          tabs: [sourceTab],
          reason: `message:${actionKey}`,
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("message.skip-incognito-source", {
      actionKey,
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      sourceUrl: sourceTab?.url || "",
    });
    return true;
  }

  function shouldApplyIncognitoSourceSkipToMessageAction(actionKey) {
    return [
      "register-preload-candidates",
      "preload-interaction-status",
      "preload-interaction-start",
      "preload-interaction-cancel",
      "report-foreground-page-digest",
      "record-attention-activity",
      "remember-source-page",
      "record-link-behavior",
      "navigation-prime-source",
      "navigation-record-link-intent",
      "navigation-resolve-click",
      "activate-preloaded-page",
    ].includes(actionKey);
  }

  async function shouldSkipMessageForProxySkippedSource(actionKey, sender) {
    if (!shouldApplyProxySourceSkipToMessageAction(actionKey)) {
      return false;
    }

    const sourceTab = sender?.tab ?? null;

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        sourceTab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
        preloadState,
        getEffectiveExtensionSettings(),
        {
          tabs: [sourceTab],
          reason: `message:${actionKey}`,
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("message.skip-proxy-source", {
      actionKey,
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      sourceUrl: sourceTab?.url || "",
    });
    return true;
  }

  function shouldApplyProxySourceSkipToMessageAction(actionKey) {
    return shouldApplyIncognitoSourceSkipToMessageAction(actionKey);
  }

  globalThis.ZeroLatencyMessageActions = {
    executeMessageDecision,
  };
})();
