(function () {
  function isSensitiveSitePreloadSkipEnabled(settings = null) {
    const runtimeSettings =
      settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);

    return runtimeSettings?.preloading?.skipSensitivePages !== false;
  }

  function inspectSensitivePreloadUrl(rawUrl, settings = null, options = {}) {
    if (!isSensitiveSitePreloadSkipEnabled(settings)) {
      return {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      };
    }

    return (
      globalThis.ZeroLatencySensitiveSiteRules?.inspectUrl?.(rawUrl, options) ?? {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      }
    );
  }

  function shouldSkipSensitivePreloadUrl(rawUrl, settings = null, options = {}) {
    return inspectSensitivePreloadUrl(rawUrl, settings, options).blocked === true;
  }

  function shouldSkipSensitivePreloadSource(tabOrUrl, settings = null) {
    const url =
      typeof tabOrUrl === "string" ? tabOrUrl : tabOrUrl?.url || tabOrUrl?.pendingUrl || "";

    return shouldSkipSensitivePreloadUrl(url, settings);
  }

  async function clearSensitivePreloadState(preloadState, settings = null, options = {}) {
    const targetState = isPlainObject(preloadState) ? preloadState : createEmptyPreloadState();

    if (!isSensitiveSitePreloadSkipEnabled(settings)) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    const tabs = Array.isArray(options?.tabs) ? options.tabs : await queryOpenNormalTabs();
    const skippedTabs = tabs.filter((tab) =>
      shouldSkipSensitivePreloadSource(tab, settings)
    );

    if (skippedTabs.length === 0) {
      return {
        preloadState: targetState,
        mutated: false,
        clearedSourceTabIds: [],
      };
    }

    return clearSensitivePreloadStateForSourceTabs(targetState, skippedTabs, {
      reason:
        typeof options?.reason === "string" ? options.reason : "sensitive-site-skip",
    });
  }

  async function clearSensitivePreloadStateForSourceTabs(preloadState, tabs, options = {}) {
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

      mutated = removeSchedulerDataForSensitiveSourceTab(preloadState, sourceTabId) || mutated;
      clearedSourceTabIds.push(sourceTabId);
    }

    if (mutated) {
      const now = new Date().toISOString();
      preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
      preloadState.scheduler.updatedAt = now;
      preloadState.updatedAt = now;
      globalThis.ZeroLatencyDebugEvents?.record?.("preload.sensitive-site.clear-state", {
        reason:
          typeof options?.reason === "string" ? options.reason : "sensitive-site-skip",
        sourceTabIds: clearedSourceTabIds,
      });
    }

    return {
      preloadState,
      mutated,
      clearedSourceTabIds,
    };
  }

  function removeSchedulerDataForSensitiveSourceTab(preloadState, sourceTabId) {
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

  globalThis.ZeroLatencyPreloadSensitiveSitePolicy = {
    isSensitiveSitePreloadSkipEnabled,
    inspectSensitivePreloadUrl,
    shouldSkipSensitivePreloadUrl,
    shouldSkipSensitivePreloadSource,
    clearSensitivePreloadState,
  };
})();
