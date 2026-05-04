(function () {
  const MAX_DEBUG_EVENT_COUNT = 256;
  let nextSequence = 1;
  const recentEvents = [];

  function record(eventName, payload = {}) {
    const normalizedEventName =
      typeof eventName === "string" && eventName ? eventName : "unknown";
    if (globalThis.ZeroLatencyDiagnostics?.isFlushInProgress?.() !== true) {
      globalThis.ZeroLatencyDiagnostics?.record?.(normalizedEventName, payload);
    }

    recentEvents.push({
      sequence: nextSequence++,
      recordedAt: new Date().toISOString(),
      eventName: normalizedEventName,
      payload: sanitizeDebugPayload(payload),
    });

    while (recentEvents.length > MAX_DEBUG_EVENT_COUNT) {
      recentEvents.shift();
    }
  }

  function snapshot(limit = MAX_DEBUG_EVENT_COUNT) {
    const normalizedLimit = Math.max(1, Number(limit) || MAX_DEBUG_EVENT_COUNT);
    return recentEvents.slice(-normalizedLimit);
  }

  function clear() {
    recentEvents.length = 0;
    nextSequence = 1;
  }

  function sanitizeDebugPayload(value, depth = 0) {
    if (value == null) {
      return value;
    }

    if (typeof value === "string" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (depth >= 3) {
      return "[truncated]";
    }

    if (Array.isArray(value)) {
      return value.slice(0, 12).map((entry) => sanitizeDebugPayload(entry, depth + 1));
    }

    if (typeof value === "object") {
      const entries = Object.entries(value).slice(0, 20);
      const normalizedObject = {};

      for (const [key, entryValue] of entries) {
        if (typeof entryValue === "function" || typeof entryValue === "undefined") {
          continue;
        }

        normalizedObject[key] = sanitizeDebugPayload(entryValue, depth + 1);
      }

      return normalizedObject;
    }

    return String(value);
  }

  globalThis.ZeroLatencyDebugEvents = {
    record,
    snapshot,
    clear,
  };
})();
