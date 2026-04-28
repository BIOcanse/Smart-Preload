async function synchronizePreloadsForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  targets
) {
  preloadState = await reassignSourceTabRuntimeIfNeeded(
    preloadState,
    normalWindowId,
    sourceTabId
  );

  const existingRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    normalWindowId,
    sourceTabId
  );

  if (!existingRuntimeEntry && targets.length === 0) {
    return preloadState;
  }

  const sourceRuntimeEntry =
    existingRuntimeEntry ?? ensureSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  const existingEntries = sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl;
  const desiredUrls = new Set(targets.map((target) => target.url));
  let preloadWindowId = null;

  for (const [url, entry] of Object.entries(existingEntries)) {
    if (desiredUrls.has(url)) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
    delete existingEntries[url];
    globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.remove", {
      normalWindowId,
      sourceTabId,
      targetUrl: url,
      removedTabId: entry?.tabId ?? null,
    });
  }

  for (const target of targets) {
    const existingEntry = existingEntries[target.url];

    if (existingEntry) {
      const liveTab = await getTabMaybe(existingEntry.tabId);

      if (!liveTab) {
        delete existingEntries[target.url];
      } else {
        existingEntry.nodeId = target.nodeId;
        existingEntry.score = target.score;
        existingEntry.scoreBreakdown = target.scoreBreakdown ?? null;
        existingEntry.transitionMetrics = target.transitionMetrics ?? null;
        existingEntry.aiKeywordMatch = target.aiKeywordMatch ?? null;
        existingEntry.siteSelection = target.siteSelection ?? null;
        existingEntry.status = liveTab.status || existingEntry.status;
        existingEntry.loadedUrl = liveTab.url || existingEntry.loadedUrl;
        existingEntry.updatedAt = new Date().toISOString();
        continue;
      }
    }

    if (preloadWindowId === null) {
      const ensuredWindow = await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
        preloadState,
        normalWindowId
      );
      preloadWindowId = ensuredWindow.windowId;
      globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.ensure-window", {
        normalWindowId,
        sourceTabId,
        preloadWindowId,
        created: ensuredWindow?.created === true,
        hiddenBySystem: ensuredWindow?.hiddenBySystem === true,
      });
    }

    existingEntries[target.url] = {
      tabId: null,
      requestedUrl: target.url,
      loadedUrl: null,
      nodeId: target.nodeId,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      siteSelection: target.siteSelection ?? null,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.queue", {
      normalWindowId,
      sourceTabId,
      preloadWindowId,
      targetUrl: target.url,
      score: target.score,
      siteSelection: target.siteSelection ?? null,
    });
    await primePreloadEntry(preloadWindowId, existingEntries[target.url]);
  }

  sourceRuntimeEntry.sourceTabRuntime.updatedAt = new Date().toISOString();
  sourceRuntimeEntry.normalWindowRuntime.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  preloadState.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;

  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);

  if (preloadWindowId !== null) {
    const updatedNormalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);
    await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(preloadWindowId, {
      hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
      hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
      normalWindowRuntime: updatedNormalWindowRuntime,
      trigger: "hidden-tab-sync",
    });
    globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.maintain-hidden", {
      normalWindowId,
      sourceTabId,
      preloadWindowId,
      hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
      hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
    });
  }

  return preloadState;
}

async function clearPreloadsForSourceTab(
  preloadState,
  normalWindowId,
  sourceTabId,
  options = {}
) {
  const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    normalWindowId,
    sourceTabId
  );

  if (!sourceRuntimeEntry) {
    return preloadState;
  }

  const keepTabIds = new Set(options.keepTabIds || []);

  for (const entry of Object.values(sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl)) {
    if (keepTabIds.has(entry.tabId)) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
  }

  sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl = {};
  sourceRuntimeEntry.sourceTabRuntime.prerenderEntriesByUrl = {};
  sourceRuntimeEntry.sourceTabRuntime.prefetchEntriesByUrl = {};
  sourceRuntimeEntry.sourceTabRuntime.updatedAt = new Date().toISOString();
  sourceRuntimeEntry.normalWindowRuntime.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  preloadState.updatedAt = sourceRuntimeEntry.sourceTabRuntime.updatedAt;
  pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
  return preloadState;
}
