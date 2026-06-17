async function synchronizeScheduledPreloadSelection(preloadState, scheduledSelection) {
  recordSchedulerRuntimeSyncEvent("scheduler.sync.source", {
    sourceTabId: scheduledSelection.sourceTabId,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourcePageUrl: scheduledSelection.sourcePageUrl,
    nativeSlots: scheduledSelection.nativeSlots,
    tabSlots: scheduledSelection.tabSlots,
    selectedCounts: countSchedulerSelectionTargets(scheduledSelection.selection),
  });
  return globalThis.ZeroLatencyPreloadDiff.applySourceTabSelection({
    preloadState,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourceTabId: scheduledSelection.sourceTabId,
    selection: scheduledSelection.selection,
  });
}

async function queryOpenNormalTabs() {
  try {
    const tabs = await chrome.tabs.query({
      windowType: "normal",
    });
    const settings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;

    return tabs.filter(
      (tab) =>
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
          tab,
          settings
        ) !== true &&
        globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
          tab,
          settings
        ) !== true
    );
  } catch (_error) {
    return [];
  }
}

async function notifyScheduledSourceTabs(scheduledSelections) {
  for (const scheduledSelection of Array.isArray(scheduledSelections)
    ? scheduledSelections
    : []) {
    try {
      await chrome.tabs.sendMessage(scheduledSelection.sourceTabId, {
        type: "preload:apply-speculation-rules",
        prerenderTargets: scheduledSelection.selection.prerenderTargets,
        prefetchTargets: scheduledSelection.selection.prefetchTargets,
      });
    } catch (_error) {
      // The tab may not currently have a live content script.
    }
  }
}

function countSchedulerSelectionTargets(selection) {
  return {
    selected: Array.isArray(selection?.selectedTargets)
      ? selection.selectedTargets.length
      : 0,
    hiddenTab: Array.isArray(selection?.tabTargets) ? selection.tabTargets.length : 0,
    prerender: Array.isArray(selection?.prerenderTargets)
      ? selection.prerenderTargets.length
      : 0,
    prefetch: Array.isArray(selection?.prefetchTargets)
      ? selection.prefetchTargets.length
      : 0,
  };
}

function recordSchedulerRuntimeSyncEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
