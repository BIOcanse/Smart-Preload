(() => {
  let controller = null;

  function initialize(options = {}) {
    if (controller) {
      return controller;
    }

    controller = globalThis.ZeroLatencySettingsHistoryTransferController.create({
      filePicker: globalThis.ZeroLatencySettingsHistoryTransferFilePicker,
      service: globalThis.ZeroLatencySettingsHistoryTransferService,
      dialogs: options.dialogs,
      translate: options.translate,
      setStatus: options.setStatus,
      controls: {
        importButton: document.getElementById("history-import-button"),
        exportButton: document.getElementById("history-export-button"),
        status: document.getElementById("history-transfer-status"),
      },
    });
    controller.initialize();
    return controller;
  }

  globalThis.ZeroLatencySettingsHistoryTransfer = {
    initialize,
  };
})();
