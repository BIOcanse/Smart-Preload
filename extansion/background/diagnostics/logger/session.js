(function () {
  function createDiagnosticSessionId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `${Date.now().toString(36)}-${randomPart}`;
  }

  function buildDiagnosticConfigSnapshot({ settings, sanitizer, sessionId }) {
    const manifest =
      typeof globalThis.chrome?.runtime?.getManifest === "function"
        ? globalThis.chrome.runtime.getManifest()
        : null;

    return {
      sessionId,
      generatedAt: new Date().toISOString(),
      extension: {
        id: typeof globalThis.chrome?.runtime?.id === "string" ? globalThis.chrome.runtime.id : null,
        version: typeof manifest?.version === "string" ? manifest.version : null,
        defaultLocale:
          typeof manifest?.default_locale === "string" ? manifest.default_locale : null,
      },
      settings: sanitizer.sanitizeSettingsForDiagnostics(settings),
    };
  }

  globalThis.ZeroLatencyDiagnosticLoggerSession = {
    createDiagnosticSessionId,
    buildDiagnosticConfigSnapshot,
  };
})();
