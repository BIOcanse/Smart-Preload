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
        await recordVisit(envelope.raw, decision.metadata?.sourceEvent || "committed");
        return;
      case "record-created-navigation-target":
        await recordCreatedNavigationTarget(envelope.raw);
        return;
      case "record-tab-replacement":
        await recordTabReplacement(envelope.raw);
        return;
      case "handle-removed-tab":
        await handleRemovedTab(envelope.raw.tabId);
        return;
      case "update-preloaded-tab-status":
        await updatePreloadedTabStatus(
          envelope.raw.tabId,
          envelope.raw.changeInfo,
          envelope.raw.tab
        );
        return;
      case "handle-removed-window":
        await globalThis.ZeroLatencyPreloadWindowManager.handleRemovedWindowEvent(
          envelope.raw.windowId
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
      default:
        return;
    }
  }

  globalThis.ZeroLatencyNavigationActions = {
    executeNavigationDecision,
  };
})();
