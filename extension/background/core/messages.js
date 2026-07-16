(function () {
  globalThis.ZeroLatencyCoreMessages = {
    ...globalThis.ZeroLatencyCoreDebugMessages,
    ...globalThis.ZeroLatencyCoreSettingsMessages,
    ...globalThis.ZeroLatencyCoreServiceControlMessages,
    ...globalThis.ZeroLatencyCoreNativeAppUpdateMessages,
    ...globalThis.ZeroLatencyCoreTaskMessages,
    ...globalThis.ZeroLatencyCoreHistoryTransferMessages,
  };
})();
