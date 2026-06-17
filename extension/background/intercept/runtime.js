(function () {
  function createRuntimeEnvelope(eventType, payload = {}) {
    return {
      kind: "runtime-lifecycle",
      phase: "internal",
      eventType,
      context: {
        areaName: typeof payload?.areaName === "string" ? payload.areaName : null,
        hasSettingsChange: Boolean(payload?.changes?.[SETTINGS_STORAGE_KEY]),
      },
      raw: payload,
    };
  }

  globalThis.ZeroLatencyRuntimeIntercept = {
    createRuntimeEnvelope,
  };
})();
