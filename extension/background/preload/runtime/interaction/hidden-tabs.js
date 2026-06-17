async function upsertHiddenTabInteractionPreload(preloadState, context, target) {
  const pressureState =
    typeof getPreloadResourcePressureState === "function"
      ? await getPreloadResourcePressureState(context.settings)
      : null;

  if (pressureState?.shouldDeferHiddenTabs === true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.hidden-tab.skip-pressure", {
      sourceTabId: context.sourceTab.id,
      sourceWindowId: context.sourceTab.windowId,
      targetUrl: context.targetUrl,
      policy: pressureState.policy,
      reason: pressureState.reason,
    });
    return preloadState;
  }

  const sourceRuntimeEntry = ensureSourceTabRuntime(
    preloadState,
    context.sourceTab.windowId,
    String(context.sourceTab.id)
  );
  const existingEntry = getSourceTabPreloadEntry(
    sourceRuntimeEntry.sourceTabRuntime,
    "hiddenTab",
    target.url
  );

  if (existingEntry) {
    const liveTab = await getTabMaybe(existingEntry.tabId);

    if (liveTab) {
      updateHiddenTabInteractionEntry(existingEntry, target, liveTab);
      markSourceRuntimeUpdated(
        preloadState,
        sourceRuntimeEntry,
        target.interactionPreload.updatedAt
      );
      return preloadState;
    }

    deleteSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab", target.url);
  }

  const ensuredWindow = await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
    preloadState,
    context.sourceTab.windowId
  );

  if (normalizePositiveInteger(ensuredWindow?.windowId) === null) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.hidden-tab.skip-window", {
      sourceTabId: context.sourceTab.id,
      sourceWindowId: context.sourceTab.windowId,
      targetUrl: context.targetUrl,
      reason: ensuredWindow?.reason ?? "missing-preload-window",
    });
    return preloadState;
  }

  const hiddenTabEntry = {
    tabId: null,
    requestedUrl: target.url,
    loadedUrl: null,
    nodeId: target.nodeId,
    score: target.score,
    scoreBreakdown: target.scoreBreakdown,
    transitionMetrics: target.transitionMetrics,
    aiKeywordMatch: null,
    bookmarkPreload: null,
    realPreloadSafety: target.realPreloadSafety ?? null,
    interactionPreload: target.interactionPreload,
    siteSelection: null,
    status: "queued",
    createdAt: target.interactionPreload.startedAt,
    updatedAt: target.interactionPreload.updatedAt,
  };
  setSourceTabPreloadEntry(
    sourceRuntimeEntry.sourceTabRuntime,
    "hiddenTab",
    target.url,
    hiddenTabEntry
  );
  await primePreloadEntry(ensuredWindow.windowId, hiddenTabEntry);

  const updatedNormalWindowRuntime = getNormalWindowRuntime(
    preloadState,
    context.sourceTab.windowId
  );
  await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
    hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
    hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
    normalWindowRuntime: updatedNormalWindowRuntime,
    trigger: "interaction-preload",
  });
  markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, target.interactionPreload.updatedAt);
  return preloadState;
}

function updateHiddenTabInteractionEntry(entry, target, liveTab) {
  entry.nodeId = target.nodeId;
  entry.score = 0;
  entry.scoreBreakdown = null;
  entry.transitionMetrics = target.transitionMetrics;
  entry.aiKeywordMatch = null;
  entry.bookmarkPreload = null;
  entry.realPreloadSafety = target.realPreloadSafety ?? null;
  entry.interactionPreload = target.interactionPreload;
  entry.siteSelection = null;
  entry.status = liveTab.status || entry.status;
  entry.loadedUrl = liveTab.url || entry.loadedUrl;
  entry.updatedAt = target.interactionPreload.updatedAt;
}

function hasContextMenuInteractionHiddenTabPreload(preloadState, context) {
  if (!context.sourceTab?.id || !context.sourceTab.windowId || !context.targetUrl) {
    return false;
  }

  const sourceRuntime = getSourceTabRuntimeForWindow(
    preloadState,
    context.sourceTab.windowId,
    String(context.sourceTab.id)
  )?.sourceTabRuntime;
  const entry = getSourceTabPreloadEntry(sourceRuntime, "hiddenTab", context.targetUrl);

  return entry?.interactionPreload?.trigger === "contextmenu";
}

async function discardContextMenuInteractionHiddenTabPreload(context) {
  if (!context.sourceTab?.id || !context.sourceTab.windowId || !context.targetUrl) {
    return {
      removed: false,
      reason: "missing-context",
    };
  }

  let preloadState = await loadPreloadState();
  const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    context.sourceTab.windowId,
    String(context.sourceTab.id)
  );
  const entry = getSourceTabPreloadEntry(
    sourceRuntimeEntry?.sourceTabRuntime,
    "hiddenTab",
    context.targetUrl
  );

  if (entry?.interactionPreload?.trigger !== "contextmenu") {
    return {
      removed: false,
      reason: "no-contextmenu-hidden-entry",
    };
  }

  await closeTabIfExists(entry.tabId);
  deleteSourceTabPreloadEntry(
    sourceRuntimeEntry.sourceTabRuntime,
    "hiddenTab",
    context.targetUrl
  );
  markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, new Date().toISOString());
  pruneSourceTabRuntime(preloadState, context.sourceTab.windowId, String(context.sourceTab.id));
  await savePreloadState(preloadState);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.discard-contextmenu", {
    sourceTabId: context.sourceTab.id,
    sourceWindowId: context.sourceTab.windowId,
    targetUrl: context.targetUrl,
    removedTabId: entry.tabId ?? null,
    reason: context.reason || "discard",
  });

  return {
    removed: true,
    tabId: entry.tabId ?? null,
  };
}
