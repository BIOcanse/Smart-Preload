(function () {
  async function executeNavigationDecision(decision, envelope) {
    if (!decision) {
      return;
    }

    if (decision.disposition === "ignore") {
      return;
    }

    switch (decision.actionKey) {
      case "record-visit":
        if (await shouldSkipNavigationForExcludedSourceTab(envelope.raw.tabId, "record-visit")) {
          return;
        }
        await recordVisit(envelope.raw, decision.metadata?.sourceEvent || "committed");
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromNavigationDetails?.(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed",
          { queue: false }
        );
        return;
      case "set-current-page":
        if (
          await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.tabId,
            "set-current-page"
          )
        ) {
          return;
        }
        await setCurrentPageFromVisit(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed"
        );
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromNavigationDetails?.(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed",
          { queue: false }
        );
        return;
      case "record-created-navigation-target":
        await recordCreatedNavigationTarget(envelope.raw);
        return;
      case "record-tab-replacement":
        if (
          (await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.tabId,
            "tab-replacement-new"
          )) ||
          (await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.replacedTabId,
            "tab-replacement-old"
          ))
        ) {
          return;
        }
        await recordTabReplacement(envelope.raw);
        return;
      case "handle-created-tab":
        await handleCreatedTabContextMenuFallback(envelope.raw);
        return;
      case "handle-removed-tab":
        await handleRemovedTab(envelope.raw.tabId);
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.pausePreloadAttentionCursorIfMatches?.(
          { tabId: envelope.raw.tabId },
          "tab-removed",
          { queue: false }
        );
        return;
      case "update-preloaded-tab-status":
        if (await handleUpdatedTabContextMenuFallback(envelope.raw)) {
          return;
        }
        await updatePreloadedTabStatus(
          envelope.raw.tabId,
          envelope.raw.changeInfo,
          envelope.raw.tab
        );
        return;
      case "handle-activated-tab":
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromActiveInfo?.(
          envelope.raw,
          "tab-activated",
          { queue: false }
        );
        await globalThis.ZeroLatencyPreloadSourceTabs.handleActivatedSourceTab(envelope.raw);
        return;
      case "handle-removed-window":
        await globalThis.ZeroLatencyPreloadWindowManager.handleRemovedWindowEvent(
          envelope.raw.windowId
        );
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.pausePreloadAttentionCursorIfMatches?.(
          { windowId: envelope.raw.windowId },
          "window-removed",
          { queue: false }
        );
        return;
      case "handle-focused-window":
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromFocusedWindow?.(
          envelope.raw.windowId,
          "window-focused",
          { queue: false }
        );
        return;
      case "handle-preload-window-bounds-changed":
        await globalThis.ZeroLatencyPreloadWindowManager.handleBoundsChangedEvent(
          envelope.raw.window
        );
        return;
      case "run-preload-watchdog":
        await globalThis.ZeroLatencyPreloadRuntimeManager.maintain();
        return;
      case "run-preload-cleanup":
        await globalThis.ZeroLatencyPreloadRuntimeManager.cleanupErroneousWindows();
        return;
      case "run-lmstudio-lifecycle-watchdog":
        await globalThis.ZeroLatencyAiProviders?.maintainLmStudioModelLifecycle?.();
        return;
      case "send-native-app-heartbeat":
        await globalThis.ZeroLatencyNativeAppHeartbeat?.send?.("alarm");
        return;
      case "run-native-app-wake-retry":
        await globalThis.ZeroLatencyNativeAppHeartbeat?.runWakeRetry?.("alarm");
        return;
      default:
        return;
    }
  }

  globalThis.ZeroLatencyNavigationActions = {
    executeNavigationDecision,
  };
})();
