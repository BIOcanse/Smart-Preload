(function () {
  function judgeNavigationEnvelope(envelope) {
    if (!envelope || envelope.kind !== "browser-event") {
      return null;
    }

    switch (envelope.eventType) {
      case "committed":
      case "history-state-updated":
        return judgeVisitEvent(envelope);
      case "created-navigation-target":
        return allowNavigationDecision("record-created-navigation-target");
      case "tab-replaced":
        return allowNavigationDecision("record-tab-replacement");
      case "tab-removed":
        return allowNavigationDecision("handle-removed-tab");
      case "tab-updated":
        return envelope.context.hasTabStatus
          ? allowNavigationDecision("update-preloaded-tab-status")
          : ignoreNavigationDecision("tab-updated");
      case "tab-activated":
        return allowNavigationDecision("handle-activated-tab");
      case "window-removed":
        return allowNavigationDecision("handle-removed-window");
      case "window-bounds-changed":
        return allowNavigationDecision("handle-preload-window-bounds-changed");
      case "alarm":
        return judgeAlarmEvent(envelope);
      default:
        return null;
    }
  }

  function judgeVisitEvent(envelope) {
    if (envelope.context.frameId !== 0) {
      return ignoreNavigationDecision(envelope.eventType);
    }

    return allowNavigationDecision("record-visit", {
      sourceEvent: envelope.context.sourceEvent,
    });
  }

  function judgeAlarmEvent(envelope) {
    switch (envelope.target.alarmName) {
      case PRELOAD_WINDOW_WATCHDOG_ALARM:
        return allowNavigationDecision("run-preload-watchdog");
      case PRELOAD_WINDOW_CLEANUP_ALARM:
        return allowNavigationDecision("run-preload-cleanup");
      case globalThis.ZeroLatencyAiProviders?.LM_STUDIO_LIFECYCLE_ALARM:
        return allowNavigationDecision("run-lmstudio-lifecycle-watchdog");
      case globalThis.ZeroLatencyNativeAppHeartbeat?.alarmName:
        return allowNavigationDecision("send-native-app-heartbeat");
      case globalThis.ZeroLatencyNativeAppHeartbeat?.wakeAlarmName:
        return allowNavigationDecision("run-native-app-wake-retry");
      default:
        return ignoreNavigationDecision("alarm");
    }
  }

  function allowNavigationDecision(actionKey, metadata = {}) {
    return {
      disposition: "allow",
      actionKey,
      metadata,
    };
  }

  function ignoreNavigationDecision(reason) {
    return {
      disposition: "ignore",
      actionKey: null,
      reason: `ignored:${reason}`,
    };
  }

  globalThis.ZeroLatencyNavigationJudge = {
    judgeNavigationEnvelope,
  };
})();
