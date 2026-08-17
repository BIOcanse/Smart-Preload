(function () {
  const DIAGNOSTIC_LOG_ENDPOINT = "/api/v1/diagnostics/logs";
  const MAX_BUFFERED_EVENTS = 2_000;
  const MAX_BATCH_SIZE = 100;
  const DEFAULT_FLUSH_DELAY_MS = 10_000;
  const RETRY_FLUSH_DELAY_MS = 30_000;

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
          // 还够一整批就立刻continue，不要再等 DEFAULT_FLUSH_DELAY_MS。
          //
          // 此前这里无条件用 nextFlushDelayMs（成功 10 秒 / 失败 30 秒），完全不看积压：
          // 缓冲上限 2000、每批 100，排空要 20 批 × 10 秒 = **200 秒连续存活**，而 MV3 的
          // service worker 约 30 秒空闲就被回收，且 setTimeout 并不延长它的寿命。
          // pushEvent 里那条 scheduleFlush(0) 快路径救不了这个场景 —— 它在
          // flushTimer 已挂或 flushInProgress 时直接返回。
          //
          // 失败路径仍然退避到 RETRY_FLUSH_DELAY_MS：那时立刻重试只会连打后端。
          const shouldContinueImmediately =
            nextFlushDelayMs === DEFAULT_FLUSH_DELAY_MS && buffer.length >= MAX_BATCH_SIZE;
          scheduleFlush(shouldContinueImmediately ? 0 : nextFlushDelayMs);
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
