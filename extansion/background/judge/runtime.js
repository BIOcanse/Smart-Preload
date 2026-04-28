(function () {
  function judgeRuntimeEnvelope(envelope) {
    if (!envelope || envelope.kind !== "runtime-lifecycle") {
      return null;
    }

    switch (envelope.eventType) {
      case "bootstrap":
        return allowRuntimeDecision("bootstrap-extension");
      case "installed":
        return allowRuntimeDecision("handle-installed");
      case "startup":
        return allowRuntimeDecision("handle-startup");
      case "storage-changed":
        if (
          envelope.context.areaName !== "local" ||
          envelope.context.hasSettingsChange !== true
        ) {
          return ignoreRuntimeDecision("storage-changed");
        }

        return allowRuntimeDecision("handle-storage-settings-change");
      default:
        return null;
    }
  }

  function allowRuntimeDecision(actionKey) {
    return {
      disposition: "allow",
      actionKey,
    };
  }

  function ignoreRuntimeDecision(reason) {
    return {
      disposition: "ignore",
      actionKey: null,
      reason: `ignored:${reason}`,
    };
  }

  globalThis.ZeroLatencyRuntimeJudge = {
    judgeRuntimeEnvelope,
  };
})();
