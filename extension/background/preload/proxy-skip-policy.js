(function () {
  const settingsApi = globalThis.ZeroLatencySettings;

  function isProxySkipPreloadEnabled(settings = null) {
    const runtimeSettings =
      settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);

    return runtimeSettings?.preloading?.proxySkip?.enabled === true;
  }

  function shouldSkipProxyPreloadUrl(url, settings = null) {
    const runtimeSettings =
      settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);

    return settingsApi?.shouldSkipProxyRuleUrl?.(url, runtimeSettings) === true;
  }

  function shouldSkipProxyPreloadSource(tab, settings = null) {
    return shouldSkipProxyPreloadUrl(tab?.url || tab?.pendingUrl || "", settings);
  }

  function shouldSkipProxyPreloadCandidate(targetUrl, settings = null) {
    return shouldSkipProxyPreloadUrl(targetUrl, settings);
  }

  async function clearProxySkippedPreloadState(preloadState, settings = null, options = {}) {
    const targetState = isPlainObject(preloadState) ? preloadState : createEmptyPreloadState();
    const runtimeSettings =
      settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);

    if (!isProxySkipPreloadEnabled(runtimeSettings)) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    const tabs = Array.isArray(options?.tabs) ? options.tabs : await queryOpenNormalTabs();
    const skippedTabs = tabs.filter((tab) =>
      shouldSkipProxyPreloadSource(tab, runtimeSettings)
    );

    if (skippedTabs.length === 0) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    return clearPreloadStateForProxySkippedSourceTabs(targetState, skippedTabs, {
      reason: typeof options?.reason === "string" ? options.reason : "proxy-skip",
    });
  }

  async function clearPreloadStateForProxySkippedSourceTabs(preloadState, tabs, options = {}) {
    let mutated = false;
    const clearedSourceTabIds = [];

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      const sourceTabId = normalizePositiveInteger(tab?.id);

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
      globalThis.ZeroLatencyDebugEvents?.record?.("preload.proxy-skip.clear-state", {
        reason: typeof options?.reason === "string" ? options.reason : "proxy-skip",
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

    const cursor = normalizePreloadAttentionCursor(preloadState.scheduler.activeTabCursor);

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

  async function queryOpenNormalTabs() {
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

  globalThis.ZeroLatencyPreloadProxySkipPolicy = {
    isProxySkipPreloadEnabled,
    shouldSkipProxyPreloadUrl,
    shouldSkipProxyPreloadSource,
    shouldSkipProxyPreloadCandidate,
    clearProxySkippedPreloadState,
    removeSchedulerDataForSourceTab,
  };
})();
