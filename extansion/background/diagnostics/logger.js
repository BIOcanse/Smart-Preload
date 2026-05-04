(function () {
  const DIAGNOSTIC_LOG_ENDPOINT = "/api/v1/diagnostics/logs";
  const MAX_BUFFERED_EVENTS = 2_000;
  const MAX_BATCH_SIZE = 100;
  const DEFAULT_FLUSH_DELAY_MS = 1_000;
  const RETRY_FLUSH_DELAY_MS = 5_000;
  const sessionId = createSessionId();
  let nextSequence = 1;
  let enabled = false;
  let buffer = [];
  let flushTimer = null;
  let flushInProgress = false;
  let lastNativeLogPath = null;

  function configureFromSettings(settings) {
    const nextEnabled = settings?.diagnostics?.enabled === true;

    if (enabled === nextEnabled) {
      return;
    }

    enabled = nextEnabled;

    if (enabled) {
      record("diagnostics.enabled", {
        sessionId,
      });
      return;
    }

    recordDisabledEvent();
    void flushNow({ finalFlush: true });
  }

  function record(eventName, payload = {}, metadata = {}) {
    if (!enabled) {
      return;
    }

    const normalizedEventName =
      typeof eventName === "string" && eventName.trim() ? eventName.trim() : "unknown";
    const event = {
      sequence: nextSequence++,
      sessionId,
      flowId: normalizeOptionalString(metadata.flowId ?? payload?.flowId),
      category: normalizeEventCategory(normalizedEventName),
      eventName: normalizedEventName,
      level: normalizeLevel(metadata.level ?? payload?.level),
      recordedAt: new Date().toISOString(),
      tabId: normalizeOptionalInteger(metadata.tabId ?? payload?.tabId),
      windowId: normalizeOptionalInteger(metadata.windowId ?? payload?.windowId),
      sourceTabId: normalizeOptionalInteger(metadata.sourceTabId ?? payload?.sourceTabId),
      sourceWindowId: normalizeOptionalInteger(
        metadata.sourceWindowId ?? payload?.sourceWindowId
      ),
      url: normalizeOptionalString(metadata.url ?? payload?.url ?? payload?.pageUrl),
      nodeId: normalizeOptionalString(metadata.nodeId ?? payload?.nodeId),
      payload: sanitizeDiagnosticPayload(payload),
    };

    buffer.push(event);

    while (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.shift();
    }

    scheduleFlush(buffer.length >= MAX_BATCH_SIZE ? 0 : DEFAULT_FLUSH_DELAY_MS);
  }

  function recordDisabledEvent() {
    if (buffer.length >= MAX_BUFFERED_EVENTS) {
      buffer.shift();
    }

    buffer.push({
      sequence: nextSequence++,
      sessionId,
      flowId: null,
      category: "diagnostics",
      eventName: "diagnostics.disabled",
      level: "info",
      recordedAt: new Date().toISOString(),
      tabId: null,
      windowId: null,
      sourceTabId: null,
      sourceWindowId: null,
      url: null,
      nodeId: null,
      payload: {
        sessionId,
      },
    });
  }

  function scheduleFlush(delayMs) {
    if (flushTimer !== null || flushInProgress || buffer.length === 0) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushNow();
    }, Math.max(0, delayMs));
  }

  async function flushNow(options = {}) {
    if (flushInProgress || buffer.length === 0) {
      return {
        ok: true,
        skipped: true,
        reason: flushInProgress ? "flush-in-progress" : "empty",
      };
    }

    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    const batch = buffer.splice(0, MAX_BATCH_SIZE);
    flushInProgress = true;
    let nextFlushDelayMs = DEFAULT_FLUSH_DELAY_MS;

    try {
      const result = await fetchNativeApp(DIAGNOSTIC_LOG_ENDPOINT, {
        method: "POST",
        timeoutMs: 5_000,
        body: {
          sessionId,
          finalFlush: options.finalFlush === true,
          events: batch,
        },
      });

      if (typeof result?.path === "string" && result.path) {
        lastNativeLogPath = result.path;
      }

      return {
        ok: true,
        written: result?.written ?? batch.length,
        path: lastNativeLogPath,
      };
    } catch (error) {
      buffer = [...batch, ...buffer].slice(0, MAX_BUFFERED_EVENTS);
      nextFlushDelayMs = RETRY_FLUSH_DELAY_MS;
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      flushInProgress = false;

      if (buffer.length > 0 && enabled) {
        scheduleFlush(nextFlushDelayMs);
      }
    }
  }

  function isFlushInProgress() {
    return flushInProgress;
  }

  function getStatus() {
    return {
      enabled,
      sessionId,
      bufferedEvents: buffer.length,
      lastNativeLogPath,
    };
  }

  function createSessionId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${randomPart}`;
  }

  function normalizeEventCategory(eventName) {
    const [category] = String(eventName || "").split(".");
    return category || "unknown";
  }

  function normalizeLevel(value) {
    return ["debug", "info", "warn", "error"].includes(value) ? value : "info";
  }

  function normalizeOptionalString(value) {
    return typeof value === "string" && value ? value : null;
  }

  function normalizeOptionalInteger(value) {
    const numericValue = Number(value);

    if (!Number.isInteger(numericValue)) {
      return null;
    }

    return numericValue;
  }

  function sanitizeDiagnosticPayload(value, depth = 0) {
    if (value == null) {
      return value;
    }

    if (typeof value === "string") {
      return value.length > 4_000 ? `${value.slice(0, 4_000)}...[truncated]` : value;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (depth >= 6) {
      return "[truncated]";
    }

    if (Array.isArray(value)) {
      return value.slice(0, 100).map((entry) => sanitizeDiagnosticPayload(entry, depth + 1));
    }

    if (typeof value === "object") {
      const normalizedObject = {};

      for (const [key, entryValue] of Object.entries(value).slice(0, 80)) {
        if (typeof entryValue === "function" || typeof entryValue === "undefined") {
          continue;
        }

        if (/apiKey|authorization|password|token/i.test(key)) {
          normalizedObject[key] = "[redacted]";
          continue;
        }

        normalizedObject[key] = sanitizeDiagnosticPayload(entryValue, depth + 1);
      }

      return normalizedObject;
    }

    return String(value);
  }

  globalThis.ZeroLatencyDiagnostics = {
    configureFromSettings,
    record,
    flushNow,
    isFlushInProgress,
    getStatus,
  };
})();
