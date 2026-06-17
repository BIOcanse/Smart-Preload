(function () {
  const incognitoMatch = globalThis.ZeroLatencyPreloadIncognitoMatch;

  async function clearExcludedIncognitoPreloadState(
    preloadState,
    settings = null,
    options = {}
  ) {
    const targetState = isPlainObject(preloadState) ? preloadState : createEmptyPreloadState();

    if (!incognitoMatch.isIncognitoPreloadExclusionEnabled(settings)) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    const tabs = Array.isArray(options?.tabs)
      ? options.tabs
      : await queryOpenIncognitoNormalTabs();
    const incognitoTabs = tabs.filter((tab) => tab?.incognito === true);

    if (incognitoTabs.length === 0) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    return clearPreloadStateForIncognitoSourceTabs(targetState, incognitoTabs, {
      reason: typeof options?.reason === "string" ? options.reason : "incognito-excluded",
    });
  }

  async function clearPreloadStateForIncognitoSourceTabs(preloadState, tabs, options = {}) {
    let mutated = false;
    const clearedSourceTabIds = [];

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      if (tab?.incognito !== true) {
        continue;
      }

      const sourceTabId = normalizePositiveInteger(tab.id);

      if (sourceTabId === null) {
        continue;
      }

      const runtimeEntry = findSourceTabRuntime(preloadState, String(sourceTabId));

      if (runtimeEntry && typeof clearPreloadsForSourceTab === "function") {
        await clearPreloadsForSourceTab(
          preloadState,
          runtimeEntry.normalWindowId,
          String(sourceTabId)
        );
        mutated = true;
      }

      mutated = removeSchedulerDataForSourceTab(preloadState, sourceTabId) || mutated;
      clearedSourceTabIds.push(sourceTabId);
    }

    if (mutated) {
      const now = new Date().toISOString();
      preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
      preloadState.scheduler.updatedAt = now;
      preloadState.updatedAt = now;
      globalThis.ZeroLatencyDebugEvents?.record?.("preload.incognito.clear-excluded-state", {
        reason: typeof options?.reason === "string" ? options.reason : "incognito-excluded",
        sourceTabIds: clearedSourceTabIds,
      });
    }

    return {
      preloadState,
      mutated,
      clearedSourceTabIds,
    };
  }

  function removeSchedulerDataForSourceTab(preloadState, sourceTabId) {
    const normalizedSourceTabId = normalizePositiveInteger(sourceTabId);

    if (normalizedSourceTabId === null) {
      return false;
    }

    let mutated = false;
    preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
    const snapshotMap = preloadState.scheduler.candidateSelectionSnapshotsByTabId || {};

    if (snapshotMap[String(normalizedSourceTabId)]) {
      delete snapshotMap[String(normalizedSourceTabId)];
      mutated = true;
    }

    for (const [key, entry] of Object.entries(
      preloadState.scheduler.attentionPendingByKey || {}
    )) {
      if (Number(entry?.tabId) !== Number(normalizedSourceTabId)) {
        continue;
      }

      delete preloadState.scheduler.attentionPendingByKey[key];
      mutated = true;
    }

    const cursor = normalizePreloadAttentionCursor(
      preloadState.scheduler.activeTabCursor
    );

    if (Number(cursor.tabId) === Number(normalizedSourceTabId)) {
      preloadState.scheduler.activeTabCursor = {
        ...cursor,
        counting: false,
        weight: 0,
        activityKind: "inactive",
        expiresAt: null,
        pendingDurationMs: 0,
        pendingStartedAt: null,
      };
      mutated = true;
    }

    return mutated;
  }

  async function queryOpenIncognitoNormalTabs() {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "query") !== true) {
      return [];
    }

    try {
      return await chrome.tabs.query({
        windowType: "normal",
      });
    } catch (_error) {
      return [];
    }
  }

  globalThis.ZeroLatencyPreloadIncognitoCleanup = {
    clearExcludedIncognitoPreloadState,
    removeSchedulerDataForSourceTab,
  };
})();
