(() => {
  async function exportHistory() {
    return sendHistoryMessage("visit-graph:export-history");
  }

  async function validateImport(backup) {
    return sendHistoryMessage("visit-graph:validate-history-import", { backup });
  }

  async function importHistory(backup) {
    return sendHistoryMessage("visit-graph:import-history", { backup });
  }

  async function sendHistoryMessage(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });

    if (response?.ok !== true) {
      const error = new Error(response?.error || "History transfer failed.");
      error.code = response?.code || "history-transfer-failed";
      throw error;
    }

    return response;
  }

  globalThis.ZeroLatencySettingsHistoryTransferService = {
    exportHistory,
    validateImport,
    importHistory,
  };
})();
