(function () {
  const runtime = globalThis.ZeroLatencyTrackingRuntime || {};

  async function resolveTrackableVisitUrl(details, sourceEvent, diagnosticPrefix) {
    const normalizedVisitUrl = normalizePageUrlForIndex(details.url || "");

    if (!isTrackableAndAllowedUrl(details.url) || !normalizedVisitUrl) {
      globalThis.ZeroLatencyDiagnostics?.record?.(`${diagnosticPrefix}.ignored`, {
        reason: "untrackable-url",
        tabId: details.tabId,
        url: details.url || "",
        sourceEvent,
      });
      return null;
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, details.tabId)) {
      globalThis.ZeroLatencyDiagnostics?.record?.(`${diagnosticPrefix}.ignored`, {
        reason: "preload-tab",
        tabId: details.tabId,
        url: details.url || "",
        sourceEvent,
      });
      return null;
    }

    return normalizedVisitUrl;
  }

  runtime.resolveTrackableVisitUrl = resolveTrackableVisitUrl;
  globalThis.ZeroLatencyTrackingRuntime = runtime;
})();
