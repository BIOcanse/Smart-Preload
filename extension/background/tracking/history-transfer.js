(function () {
  const service = globalThis.ZeroLatencyTrackingHistoryTransferService;

  globalThis.ZeroLatencyTrackingHistoryTransfer = {
    exportHistory: service.exportHistory,
    validateHistoryImport: service.validateHistoryImport,
    importHistory: service.importHistory,
  };
})();
