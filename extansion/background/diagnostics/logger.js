(function () {
  const sanitizer = globalThis.ZeroLatencyDiagnosticSanitizer;
  const {
    createDiagnosticSessionId,
    buildDiagnosticConfigSnapshot,
  } = globalThis.ZeroLatencyDiagnosticLoggerSession;
  const {
    createDiagnosticEvent,
    createDiagnosticDisabledEvent,
  } = globalThis.ZeroLatencyDiagnosticLoggerEvent;
  const {
    createDiagnosticLogBuffer,
  } = globalThis.ZeroLatencyDiagnosticLoggerFlushBuffer;

  const sessionId = createDiagnosticSessionId();
  let nextSequence = 1;
  let enabled = false;
  const logBuffer = createDiagnosticLogBuffer({
    sessionId,
    fetchNativeApp: (...args) => fetchNativeApp(...args),
    isEnabled: () => enabled,
  });

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
      record(
        "diagnostics.config",
        buildDiagnosticConfigSnapshot({
          settings,
          sanitizer,
          sessionId,
        })
      );
      return;
    }

    logBuffer.pushEvent(
      createDiagnosticDisabledEvent({
        sequence: nextSequence++,
        sessionId,
      }),
      { schedule: false }
    );
    void logBuffer.flushNow({ finalFlush: true });
  }

  function record(eventName, payload = {}, metadata = {}) {
    if (!enabled) {
      return;
    }

    logBuffer.pushEvent(
      createDiagnosticEvent({
        eventName,
        payload,
        metadata,
        sanitizer,
        sequence: nextSequence++,
        sessionId,
      })
    );
  }

  function flushNow(options = {}) {
    return logBuffer.flushNow(options);
  }

  function isFlushInProgress() {
    return logBuffer.isFlushInProgress();
  }

  function getStatus() {
    return logBuffer.getStatus({ enabled });
  }

  globalThis.ZeroLatencyDiagnostics = {
    configureFromSettings,
    record,
    flushNow,
    isFlushInProgress,
    getStatus,
  };
})();
