(function () {
  const DIAGNOSTIC_LOG_ENDPOINT = "/api/v1/diagnostics/logs";
  const MAX_BUFFERED_EVENTS = 2_000;
  const MAX_BATCH_SIZE = 100;
  const DEFAULT_FLUSH_DELAY_MS = 1_000;
  const RETRY_FLUSH_DELAY_MS = 5_000;

  function createDiagnosticLogBuffer({ sessionId, fetchNativeApp, isEnabled }) {
    let buffer = [];
    let flushTimer = null;
    let flushInProgress = false;
    let lastNativeLogPath = null;

    function pushEvent(event, options = {}) {
      buffer.push(event);

      while (buffer.length > MAX_BUFFERED_EVENTS) {
        buffer.shift();
      }

      if (options.schedule !== false) {
        scheduleFlush(buffer.length >= MAX_BATCH_SIZE ? 0 : DEFAULT_FLUSH_DELAY_MS);
      }
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

        if (buffer.length > 0 && isEnabled()) {
          scheduleFlush(nextFlushDelayMs);
        }
      }
    }

    function isFlushInProgress() {
      return flushInProgress;
    }

    function getStatus({ enabled }) {
      return {
        enabled,
        sessionId,
        bufferedEvents: buffer.length,
        lastNativeLogPath,
      };
    }

    return {
      pushEvent,
      flushNow,
      isFlushInProgress,
      getStatus,
    };
  }

  globalThis.ZeroLatencyDiagnosticLoggerFlushBuffer = {
    createDiagnosticLogBuffer,
  };
})();
