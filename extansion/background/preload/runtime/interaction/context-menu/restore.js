async function restoreActivatedContextMenuTarget(activation, targetWindowId) {
  const activatedTabId = normalizePositiveInteger(activation?.tabId);
  const destinationWindowId = normalizePositiveInteger(targetWindowId);

  if (activatedTabId === null) {
    return;
  }

  try {
    await chrome.tabs.update(activatedTabId, { active: true });

    if (destinationWindowId !== null) {
      await chrome.windows.update(destinationWindowId, { focused: true });
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.contextmenu-restored", {
      activatedTabId,
      targetWindowId: destinationWindowId,
    });
  } catch (error) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.contextmenu-restore-failed", {
      activatedTabId,
      targetWindowId: destinationWindowId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

globalThis.ZeroLatencyContextMenuPreloadRestore = {
  restoreActivatedContextMenuTarget,
};
