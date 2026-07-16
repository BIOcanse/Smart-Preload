(function () {
  const format = globalThis.ZeroLatencyTrackingHistoryTransferFormat;

  async function exportHistory() {
    const snapshot = await loadTrackingStateWithCompleteHistory();
    return format.createHistoryBackup(snapshot.graph, {
      extensionVersion: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
    });
  }

  function validateHistoryImport(rawBackup) {
    const parsed = format.parseHistoryBackup(rawBackup);

    return {
      metadata: parsed.metadata,
      summary: parsed.summary,
    };
  }

  async function importHistory(rawBackup) {
    const parsed = format.parseHistoryBackup(rawBackup);
    const currentState = await loadTrackingState();
    const nextState = {
      graph: parsed.graph,
      tabState: currentState.tabState,
      pendingSources: currentState.pendingSources,
    };

    await replaceTrackingHistoryArchive(nextState);
    globalThis.ZeroLatencyDebugEvents?.record?.("tracking.history.import", {
      metadata: parsed.metadata,
      summary: parsed.summary,
    });

    return {
      ok: true,
      metadata: parsed.metadata,
      summary: parsed.summary,
    };
  }

  globalThis.ZeroLatencyTrackingHistoryTransferService = {
    exportHistory,
    validateHistoryImport,
    importHistory,
  };
})();
