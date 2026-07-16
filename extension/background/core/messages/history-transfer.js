(function () {
  async function handleExportHistory() {
    const backup = await globalThis.ZeroLatencyTrackingHistoryTransfer.exportHistory();

    return {
      ok: true,
      backup,
    };
  }

  function handleValidateHistoryImport(message) {
    const validation = globalThis.ZeroLatencyTrackingHistoryTransfer.validateHistoryImport(
      message?.backup
    );

    return {
      ok: true,
      ...validation,
    };
  }

  async function handleImportHistory(message) {
    return globalThis.ZeroLatencyTrackingHistoryTransfer.importHistory(message?.backup);
  }

  globalThis.ZeroLatencyCoreHistoryTransferMessages = {
    handleExportHistory,
    handleValidateHistoryImport,
    handleImportHistory,
  };
})();
