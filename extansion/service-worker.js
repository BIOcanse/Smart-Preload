importScripts("shared/settings.js");

const settingsApi = globalThis.ZeroLatencySettings;
const SETTINGS_STORAGE_KEY = settingsApi.SETTINGS_STORAGE_KEY;
const GRAPH_KEY = "visitGraphV1";
const TAB_STATE_KEY = "tabVisitStateV1";
const PENDING_SOURCE_KEY = "pendingVisitSourcesV1";
const PRELOAD_STATE_KEY = "preloadStateV1";
const MAX_DEBUG_TRANSITIONS = 30;
const STARTUP_SYNC_MESSAGE_WINDOW = 10;
const WASM_ENGINE_PATH = "wasm/pkg/visit_graph_engine.wasm";
const PRELOAD_WINDOW_WATCHDOG_ALARM = "preload-window-watchdog";
const BUCKET_PRIMARY_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789_";
const BUCKET_SECONDARY_BLANK_INDEX = BUCKET_PRIMARY_CHARSET.length;
const OUTBOUND_BUCKET_COUNT =
  BUCKET_PRIMARY_CHARSET.length * (BUCKET_PRIMARY_CHARSET.length + 1);
const TRANSITION_WINDOW_KEYS = ["total", "last365d", "last30d", "last7d", "last1d"];

let mutationQueue = Promise.resolve();
let visitGraphEnginePromise = null;
let expectedPreloadTabRemovals = new Set();
let cachedUserSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);

void bootstrapExtensionRuntime();

chrome.runtime.onInstalled.addListener(() => {
  queueMutation(async () => {
    await initializeExtensionState();
    await applyRuntimeSettings();
    console.log("Zero-Latency Web visit tracker installed.");
  });
});

chrome.runtime.onStartup.addListener(() => {
  queueMutation(async () => {
    await initializeExtensionState();
    await applyRuntimeSettings();
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_STORAGE_KEY]) {
    return;
  }

  queueMutation(async () => {
    cachedUserSettings = settingsApi.normalizeStoredSettings(
      changes[SETTINGS_STORAGE_KEY].newValue
    );
    await applyRuntimeSettings();
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  queueMutation(async () => {
    await recordVisit(details, "committed");
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  queueMutation(async () => {
    await recordVisit(details, "history-state-updated");
  });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  queueMutation(async () => {
    await recordCreatedNavigationTarget(details);
  });
});

chrome.webNavigation.onTabReplaced.addListener((details) => {
  queueMutation(async () => {
    await recordTabReplacement(details);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueMutation(async () => {
    await handleRemovedTab(tabId);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url) {
    return;
  }

  queueMutation(async () => {
    await updatePreloadedTabStatus(tabId, changeInfo, tab);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  queueMutation(async () => {
    await handleRemovedWindow(windowId);
  });
});

chrome.windows.onBoundsChanged.addListener((window) => {
  queueMutation(async () => {
    await handlePreloadWindowBoundsChanged(window);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== PRELOAD_WINDOW_WATCHDOG_ALARM) {
    return;
  }

  queueMutation(async () => {
    await enforcePreloadWindowPolicy();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "visit-graph:get-debug-snapshot") {
    return respondWithTask(sendResponse, async () => {
      const trackingState = await loadTrackingState();
      const preloadState = await loadPreloadState();
      const pageContext = buildPageContext(
        trackingState,
        preloadState,
        message?.tabId,
        message?.pageUrl
      );

      return {
        summary: buildDebugSnapshot(trackingState.graph),
        pageContext,
        currentTopDestinations: buildCurrentTopDestinations(
          trackingState.graph,
          pageContext.nodeId,
          pageContext.pageUrl
        ),
        currentPreloads: buildCurrentPreloads(preloadState, message?.tabId),
      };
    });
  }

  if (message?.type === "visit-graph:reset") {
    return respondWithTask(sendResponse, async () => {
      await resetPreloads();
      await chrome.storage.local.set({
        [GRAPH_KEY]: createEmptyGraph(),
        [TAB_STATE_KEY]: {},
        [PENDING_SOURCE_KEY]: {},
      });

      return { ok: true };
    });
  }

  if (message?.type === "preload:register-candidates") {
    return respondWithTask(sendResponse, async () => {
      return registerPreloadCandidates(message, sender);
    });
  }

  if (message?.type === "preload:activate-if-ready") {
    return respondWithTask(sendResponse, async () => {
      return activatePreloadedPage(message, sender);
    });
  }

  return false;
});

function queueMutation(task) {
  mutationQueue = mutationQueue
    .then(task)
    .catch((error) => {
      console.error("Zero-Latency mutation failed.", error);
    });

  return mutationQueue;
}

function bootstrapExtensionRuntime() {
  queueMutation(async () => {
    await initializeExtensionState();
    await applyRuntimeSettings();
  });
}

async function applyRuntimeSettings() {
  await ensurePreloadWindowWatchdog();

  if (!getEffectiveExtensionSettings().preloading.enabled) {
    await resetPreloads();
    return;
  }

  await enforcePreloadWindowPolicy();
  await requestPreloadCandidateRefreshForOpenTabs();
}

function getEffectiveExtensionSettings() {
  return settingsApi.resolveEffectiveSettings(cachedUserSettings);
}

async function requestPreloadCandidateRefreshForOpenTabs() {
  const preloadState = await loadPreloadState();
  const tabs = await chrome.tabs.query({
    windowType: "normal",
  });

  for (const tab of tabs) {
    if (!tab.id || !isTrackableUrl(tab.url || "") || isPreloadTab(preloadState, tab.id)) {
      continue;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "preload:collect-candidates",
      });
    } catch (_error) {
      // Some pages may not have an active content script or may reject messaging.
    }
  }
}

function respondWithTask(sendResponse, task) {
  queueMutation(async () => {
    try {
      sendResponse(await task());
    } catch (error) {
      console.error("Zero-Latency message handler failed.", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return true;
}

async function recordVisit(details, sourceEvent) {
  if (!isTrackableUrl(details.url)) {
    return;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId)) {
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-visit",
    tabId: String(details.tabId),
    targetNode: buildNodeSeed(details.url),
    occurredAt: toIsoTimestamp(details.timeStamp),
    eventType: sourceEvent,
    transitionType: details.transitionType || "unknown",
    url: details.url,
  });

  await saveTrackingState(nextTrackingState);
}

async function recordCreatedNavigationTarget(details) {
  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.sourceTabId) || isPreloadTab(preloadState, details.tabId)) {
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-created-navigation-target",
    sourceTabId: String(details.sourceTabId),
    targetTabId: String(details.tabId),
    occurredAt: toIsoTimestamp(details.timeStamp),
  });

  await saveTrackingState(nextTrackingState);
}

async function recordTabReplacement(details) {
  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, details.tabId) || isPreloadTab(preloadState, details.replacedTabId)) {
    return;
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "record-tab-replacement",
    replacedTabId: String(details.replacedTabId),
    newTabId: String(details.tabId),
  });

  await saveTrackingState(nextTrackingState);
}

async function handleRemovedTab(tabId) {
  const trackingState = await loadTrackingState();
  const nextTrackingState = await applyTrackingEvent(trackingState, {
    type: "remove-tab",
    tabId: String(tabId),
  });

  await saveTrackingState(nextTrackingState);

  let preloadState = await loadPreloadState();
  const preloadTabEntry = findPreloadEntryByTabId(preloadState, tabId);
  const expectedPreloadRemoval = expectedPreloadTabRemovals.delete(Number(tabId));

  if (preloadTabEntry) {
    const entry =
      preloadState.entriesBySourceTab[preloadTabEntry.sourceTabId]?.[preloadTabEntry.url];

    if (entry) {
      if (expectedPreloadRemoval) {
        delete preloadState.entriesBySourceTab[preloadTabEntry.sourceTabId][preloadTabEntry.url];

        if (!Object.keys(preloadState.entriesBySourceTab[preloadTabEntry.sourceTabId]).length) {
          delete preloadState.entriesBySourceTab[preloadTabEntry.sourceTabId];
        }
      } else {
        entry.tabId = null;
        entry.loadedUrl = null;
        entry.status = "missing";
        entry.updatedAt = new Date().toISOString();
      }
    }
  }

  if (
    preloadState.entriesBySourceTab[String(tabId)] ||
    preloadState.prerenderEntriesBySourceTab[String(tabId)] ||
    preloadState.prefetchEntriesBySourceTab[String(tabId)]
  ) {
    preloadState = await clearPreloadsForSourceTab(preloadState, String(tabId));
  }

  await savePreloadState(preloadState);
}

async function handleRemovedWindow(windowId) {
  const preloadState = await loadPreloadState();

  if (preloadState.windowId !== windowId) {
    return;
  }

  preloadState.windowId = null;
  preloadState.updatedAt = new Date().toISOString();
  await savePreloadState(preloadState);
}

async function updatePreloadedTabStatus(tabId, changeInfo, tab) {
  const preloadState = await loadPreloadState();
  const preloadEntry = findPreloadEntryByTabId(preloadState, tabId);

  if (!preloadEntry) {
    return;
  }

  const entry = preloadState.entriesBySourceTab[preloadEntry.sourceTabId][preloadEntry.url];

  if (changeInfo.status) {
    entry.status = changeInfo.status;
  }

  if (tab?.url) {
    entry.loadedUrl = tab.url;
  }

  entry.updatedAt = new Date().toISOString();
  await savePreloadState(preloadState);
}

async function handlePreloadWindowBoundsChanged(window) {
  const preloadState = await loadPreloadState();

  if (preloadState.windowId !== window.id) {
    return;
  }

  if (!getEffectiveExtensionSettings().preloadWindow.forceMinimize) {
    return;
  }

  if (window.state !== "minimized") {
    await keepPreloadWindowMinimized(window.id);
  }
}

async function registerPreloadCandidates(message, sender) {
  const sourceTabId = sender?.tab?.id;

  if (!sourceTabId || !isTrackableUrl(message?.pageUrl || sender.tab?.url || "")) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  let preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, sourceTabId)) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  const runtimeSettings = getEffectiveExtensionSettings();

  if (!runtimeSettings.preloading.enabled) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  const trackingState = await loadTrackingState();
  const currentNodeId =
    trackingState.tabState[String(sourceTabId)]?.nodeId ??
    buildNodeSeed(message.pageUrl || sender.tab.url).nodeId;
  const selection = selectPreloadTargets({
    currentNodeId,
    sourceUrl: message.pageUrl || sender.tab.url,
    candidateLinks: Array.isArray(message.links) ? message.links : [],
    graph: trackingState.graph,
    settings: runtimeSettings,
  });

  preloadState = await synchronizePreloadsForSourceTab(
    preloadState,
    String(sourceTabId),
    selection.tabTargets
  );
  preloadState = synchronizePrerenderEntriesForSourceTab(
    preloadState,
    String(sourceTabId),
    selection.selectedTargets.filter((target) => target.strategy === "prerender")
  );
  preloadState = synchronizePrefetchEntriesForSourceTab(
    preloadState,
    String(sourceTabId),
    selection.selectedTargets.filter((target) => target.strategy === "prefetch")
  );

  await savePreloadState(preloadState);

  return {
    ok: true,
    preloadedCount: selection.tabTargets.length,
    prerenderCount: selection.prerenderTargets.length,
    prefetchCount: selection.prefetchTargets.length,
    prerenderTargets: selection.prerenderTargets,
    prefetchTargets: selection.prefetchTargets,
    crossSiteCurrentTabSwapEnabled:
      runtimeSettings.preloading.crossSiteCurrentTabSwap === true,
    targets: selection.selectedTargets.map((target) => ({
      url: target.url,
      score: target.score,
      nodeId: target.nodeId,
      targetHint: target.targetHint,
      strategy: target.strategy,
    })),
  };
}

async function activatePreloadedPage(message, sender) {
  const sourceTab = sender?.tab;
  const openInNewTab = message?.openInNewTab === true;

  if (!sourceTab?.id || !sourceTab.windowId || !isTrackableUrl(message?.url || "")) {
    return { handled: false };
  }

  const sourceWindow = await chrome.windows.get(sourceTab.windowId);

  if (sourceWindow.type !== "normal") {
    return { handled: false };
  }

  let preloadState = await loadPreloadState();
  const sourceTabId = String(sourceTab.id);
  const entry = preloadState.entriesBySourceTab[sourceTabId]?.[message.url];

  if (!entry) {
    return { handled: false };
  }

  const preloadedTab = await getTabMaybe(entry.tabId);

  if (!preloadedTab) {
    delete preloadState.entriesBySourceTab[sourceTabId][message.url];
    await savePreloadState(preloadState);
    return { handled: false };
  }

  if ((entry.status || preloadedTab.status) !== "complete") {
    return { handled: false };
  }

  const movedTab = await chrome.tabs.move(preloadedTab.id, {
    windowId: sourceTab.windowId,
    index: (sourceTab.index ?? 0) + 1,
  });
  const activatedTab = Array.isArray(movedTab) ? movedTab[0] : movedTab;

  await chrome.tabs.update(activatedTab.id, { active: true });

  const trackingState = await loadTrackingState();
  const nextTrackingState = await recordActivatedPreloadedTransition({
    trackingState,
    sourceTab,
    activatedTab,
    targetUrl: message.url,
    keepSourceTab: openInNewTab,
  });

  await saveTrackingState(nextTrackingState);

  preloadState = await clearPreloadsForSourceTab(preloadState, sourceTabId, {
    keepTabIds: [activatedTab.id],
  });
  await savePreloadState(preloadState);

  if (!openInNewTab) {
    await chrome.tabs.remove(sourceTab.id);
  }

  try {
    await chrome.tabs.sendMessage(activatedTab.id, {
      type: "preload:collect-candidates",
    });
  } catch (_error) {
    // The destination tab may not have a content script yet on some pages.
  }

  return {
    handled: true,
    tabId: activatedTab.id,
  };
}

async function recordActivatedPreloadedTransition({
  trackingState,
  sourceTab,
  activatedTab,
  targetUrl,
  keepSourceTab = false,
}) {
  let nextState = trackingState;
  const sourceTabId = String(sourceTab.id);
  const sourceNodeId =
    nextState.tabState[sourceTabId]?.nodeId ??
    (isTrackableUrl(sourceTab.url || "") ? buildNodeSeed(sourceTab.url).nodeId : null);
  const activatedTabId = String(activatedTab.id);
  const occurredAt = new Date().toISOString();

  if (sourceNodeId) {
    nextState.pendingSources[activatedTabId] = {
      nodeId: sourceNodeId,
      pageUrl: normalizePageUrlForIndex(sourceTab.url || ""),
      createdAt: occurredAt,
    };
  }

  nextState = await applyTrackingEvent(nextState, {
    type: "record-visit",
    tabId: activatedTabId,
    targetNode: buildNodeSeed(targetUrl),
    occurredAt,
    eventType: "preloaded-tab-activation",
    transitionType: "link",
    url: targetUrl,
  });

  if (!keepSourceTab) {
    nextState = await applyTrackingEvent(nextState, {
      type: "remove-tab",
      tabId: sourceTabId,
    });
  }

  return nextState;
}

async function synchronizePreloadsForSourceTab(preloadState, sourceTabId, targets) {
  const windowId = await ensurePreloadWindow(preloadState);
  const desiredUrls = new Set(targets.map((target) => target.url));
  const existingEntries = preloadState.entriesBySourceTab[sourceTabId] ?? {};

  for (const [url, entry] of Object.entries(existingEntries)) {
    if (desiredUrls.has(url)) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
    delete existingEntries[url];
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
        existingEntry.status = liveTab.status || existingEntry.status;
        existingEntry.loadedUrl = liveTab.url || existingEntry.loadedUrl;
        existingEntry.updatedAt = new Date().toISOString();
        continue;
      }
    }

    existingEntries[target.url] = {
      tabId: null,
      requestedUrl: target.url,
      loadedUrl: null,
      nodeId: target.nodeId,
      score: target.score,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await primePreloadEntry(windowId, existingEntries[target.url]);
  }

  preloadState.entriesBySourceTab[sourceTabId] = existingEntries;
  preloadState.updatedAt = new Date().toISOString();

  await keepPreloadWindowMinimized(windowId);
  return preloadState;
}

async function clearPreloadsForSourceTab(preloadState, sourceTabId, options = {}) {
  const existingEntries = preloadState.entriesBySourceTab[sourceTabId];

  if (!existingEntries) {
    delete preloadState.prerenderEntriesBySourceTab[sourceTabId];
    delete preloadState.prefetchEntriesBySourceTab[sourceTabId];
    return preloadState;
  }

  const keepTabIds = new Set(options.keepTabIds || []);

  for (const entry of Object.values(existingEntries)) {
    if (keepTabIds.has(entry.tabId)) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
  }

  delete preloadState.entriesBySourceTab[sourceTabId];
  delete preloadState.prerenderEntriesBySourceTab[sourceTabId];
  delete preloadState.prefetchEntriesBySourceTab[sourceTabId];
  preloadState.updatedAt = new Date().toISOString();
  return preloadState;
}

function synchronizePrerenderEntriesForSourceTab(preloadState, sourceTabId, targets) {
  const nextEntries = {};

  for (const target of targets) {
    nextEntries[target.url] = {
      requestedUrl: target.url,
      nodeId: target.nodeId,
      score: target.score,
      status: "prerender",
      strategy: "prerender",
      targetHint: target.targetHint,
      updatedAt: new Date().toISOString(),
    };
  }

  if (Object.keys(nextEntries).length > 0) {
    preloadState.prerenderEntriesBySourceTab[sourceTabId] = nextEntries;
  } else {
    delete preloadState.prerenderEntriesBySourceTab[sourceTabId];
  }

  preloadState.updatedAt = new Date().toISOString();
  return preloadState;
}

function synchronizePrefetchEntriesForSourceTab(preloadState, sourceTabId, targets) {
  const nextEntries = {};

  for (const target of targets) {
    nextEntries[target.url] = {
      requestedUrl: target.url,
      nodeId: target.nodeId,
      score: target.score,
      status: "prefetch",
      strategy: "prefetch",
      updatedAt: new Date().toISOString(),
    };
  }

  if (Object.keys(nextEntries).length > 0) {
    preloadState.prefetchEntriesBySourceTab[sourceTabId] = nextEntries;
  } else {
    delete preloadState.prefetchEntriesBySourceTab[sourceTabId];
  }

  preloadState.updatedAt = new Date().toISOString();
  return preloadState;
}

async function resetPreloads() {
  const preloadState = await loadPreloadState();

  for (const entries of Object.values(preloadState.entriesBySourceTab)) {
    for (const entry of Object.values(entries)) {
      await closeTabIfExists(entry.tabId);
    }
  }

  if (preloadState.windowId) {
    try {
      await chrome.windows.remove(preloadState.windowId);
    } catch (_error) {
      // The preload window may already be gone.
    }
  }

  await savePreloadState(createEmptyPreloadState());
}

async function ensurePreloadWindow(preloadState) {
  if (preloadState.windowId) {
    const existingWindow = await getWindowMaybe(preloadState.windowId);

    if (existingWindow?.type === "normal") {
      return existingWindow.id;
    }
  }

  const createdWindow = await chrome.windows.create({
    url: "about:blank",
    focused: false,
    state: "minimized",
    type: "normal",
  });

  preloadState.windowId = createdWindow.id;
  preloadState.updatedAt = new Date().toISOString();
  return createdWindow.id;
}

async function enforcePreloadWindowPolicy() {
  if (!getEffectiveExtensionSettings().preloading.enabled) {
    return;
  }

  let preloadState = await loadPreloadState();
  const shouldMaintainWindow =
    Boolean(preloadState.windowId) || hasTrackedPreloadEntries(preloadState);

  if (!shouldMaintainWindow) {
    return;
  }

  const windowId = await ensurePreloadWindow(preloadState);
  const didRepairEntries = await repairPreloadEntries(preloadState, windowId);

  await keepPreloadWindowMinimized(windowId);

  if (didRepairEntries) {
    preloadState.updatedAt = new Date().toISOString();
  }

  await savePreloadState(preloadState);
}

async function keepPreloadWindowMinimized(windowId) {
  if (!getEffectiveExtensionSettings().preloadWindow.forceMinimize) {
    return;
  }

  try {
    await chrome.windows.update(windowId, {
      focused: false,
      state: "minimized",
    });
  } catch (_error) {
    // Ignore transient window update failures.
  }
}

async function primePreloadEntry(windowId, entry) {
  const blankTab = await chrome.tabs.create({
    windowId,
    url: "about:blank",
    active: false,
    index: -1,
  });

  entry.tabId = blankTab.id;
  entry.loadedUrl = null;
  entry.status = "priming";
  entry.updatedAt = new Date().toISOString();

  try {
    await chrome.tabs.update(blankTab.id, { autoDiscardable: false });
  } catch (_error) {
    // Older Chrome builds may reject autoDiscardable updates.
  }

  await chrome.tabs.update(blankTab.id, {
    url: entry.requestedUrl,
    active: false,
  });

  entry.status = "loading";
  entry.updatedAt = new Date().toISOString();
}

async function repairPreloadEntries(preloadState, preloadWindowId) {
  let didMutate = false;

  for (const sourceTabId of Object.keys(preloadState.entriesBySourceTab)) {
    const sourceTab = await getTabMaybe(Number(sourceTabId));

    if (!sourceTab) {
      delete preloadState.entriesBySourceTab[sourceTabId];
      didMutate = true;
      continue;
    }

    for (const entry of Object.values(preloadState.entriesBySourceTab[sourceTabId])) {
      const liveTab = entry.tabId ? await getTabMaybe(entry.tabId) : null;

      if (!liveTab) {
        await primePreloadEntry(preloadWindowId, entry);
        didMutate = true;
        continue;
      }

      if (liveTab.windowId !== preloadWindowId) {
        try {
          await chrome.tabs.move(liveTab.id, {
            windowId: preloadWindowId,
            index: -1,
          });
          await chrome.tabs.update(liveTab.id, { active: false });

          try {
            await chrome.tabs.update(liveTab.id, { autoDiscardable: false });
          } catch (_error) {
            // Older Chrome builds may reject autoDiscardable updates.
          }

          entry.tabId = liveTab.id;
        } catch (_error) {
          await closeTabIfExists(liveTab.id);
          await primePreloadEntry(preloadWindowId, entry);
        }

        didMutate = true;
      }

      entry.loadedUrl = liveTab.url || entry.loadedUrl;
      entry.status = liveTab.status || entry.status;
      entry.updatedAt = new Date().toISOString();
    }
  }

  return didMutate;
}

function hasTrackedPreloadEntries(preloadState) {
  return Object.values(preloadState.entriesBySourceTab).some(
    (entries) => Object.keys(entries).length > 0
  );
}

function selectPreloadTargets({ currentNodeId, sourceUrl, candidateLinks, graph, settings }) {
  const sourceNodeId = currentNodeId || buildNodeSeed(sourceUrl).nodeId;
  const maxTargets =
    settings?.preloading?.effectiveMaxTabsPerSource ??
    settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource;
  const candidatePool = buildPreloadCandidatePool({
    sourceNodeId,
    sourceUrl,
    candidateLinks,
    graph,
  });
  const filteredCandidates = applyOrderedPreloadRules(candidatePool, settings);

  filteredCandidates.sort(comparePreloadCandidatePriority);
  const selectedTargets = filteredCandidates.slice(0, maxTargets);

  return {
    selectedTargets: selectedTargets.map((candidate) => ({
      url: candidate.url,
      nodeId: candidate.nodeId,
      score: candidate.score,
      targetHint: candidate.targetHint,
      strategy: determinePreloadStrategy(candidate, settings),
    })),
    prerenderTargets: selectedTargets
      .filter((candidate) => determinePreloadStrategy(candidate, settings) === "prerender")
      .map((candidate) => ({
        url: candidate.url,
        targetHint: candidate.targetHint,
      })),
    prefetchTargets: selectedTargets
      .filter((candidate) => determinePreloadStrategy(candidate, settings) === "prefetch")
      .map((candidate) => ({
        url: candidate.url,
      })),
    tabTargets: selectedTargets
      .filter((candidate) => determinePreloadStrategy(candidate, settings) === "hidden-tab")
      .map((candidate) => ({
        url: candidate.url,
        nodeId: candidate.nodeId,
        score: candidate.score,
        targetHint: candidate.targetHint,
      })),
  };
}

function determinePreloadStrategy(candidate, settings) {
  if (candidate.isSameOrigin) {
    return "prerender";
  }

  if (candidate.targetHint === "_blank") {
    return "hidden-tab";
  }

  return settings?.preloading?.crossSiteCurrentTabSwap ? "hidden-tab" : "prefetch";
}

function buildPreloadCandidatePool({ sourceNodeId, sourceUrl, candidateLinks, graph }) {
  const googleSearchSource = isGoogleSearchNodeId(sourceNodeId);
  const sourcePageUrl = normalizePageUrlForIndex(sourceUrl);
  const seen = new Set();
  const candidatePool = [];

  for (let index = 0; index < candidateLinks.length; index += 1) {
    const candidate = candidateLinks[index];
    const candidateUrl = normalizeNavigableUrl(candidate?.url, sourceUrl);

    if (!candidateUrl || candidateUrl === sourceUrl || seen.has(candidateUrl)) {
      continue;
    }

    seen.add(candidateUrl);
    const targetNodeId = buildNodeSeed(candidateUrl).nodeId;
    const targetPageUrl = normalizePageUrlForIndex(candidateUrl);
    const edge = graph.edges[`${sourceNodeId} -> ${targetNodeId}`] ?? null;
    const siteTransitionCount = getTransitionCount(graph, "total", sourceNodeId, targetNodeId);
    const pageTransitionCount = getPageTransitionCount(
      graph,
      "total",
      sourceNodeId,
      sourcePageUrl,
      targetNodeId,
      targetPageUrl
    );
    const transitionCount = pageTransitionCount || siteTransitionCount;
    const visibilityScore = Number(candidate.visibility) || 0;
    let score = transitionCount * 10000 + visibilityScore;

    if (transitionCount === 0) {
      if (googleSearchSource && targetNodeId !== sourceNodeId) {
        score = 5000 + visibilityScore;
      } else if (index < 2) {
        score = 1000 - index;
      } else {
        score = Math.floor(visibilityScore / 100);
      }
    }

    if (score <= 0) {
      continue;
    }

    candidatePool.push({
      url: candidateUrl,
      nodeId: targetNodeId,
      score,
      targetHint: candidate?.targetHint === "_blank" ? "_blank" : "_self",
      isSameOrigin: isSameOriginUrl(sourceUrl, candidateUrl),
      siteTransitionCount,
      pageTransitionCount,
      transitionCount,
      transitionStats: edge?.transitionStats ?? createEmptyTransitionStats(),
      visibilityScore,
      linkIndex: index,
    });
  }

  return candidatePool;
}

function applyOrderedPreloadRules(candidatePool, settings) {
  let workingPool = [...candidatePool];
  const orderedRuleIds = Array.isArray(settings?.layout?.sortableCards?.order)
    ? settings.layout.sortableCards.order
    : [];
  const ruleItems = settings?.layout?.sortableCards?.items ?? {};

  for (const ruleCardId of orderedRuleIds) {
    const ruleCardState = ruleItems[ruleCardId];

    if (!settingsApi.isRuleCardEnabled(ruleCardState)) {
      continue;
    }

    switch (ruleCardId) {
      case "highFrequencyRank":
        workingPool = applyHighFrequencyRankRule(workingPool, ruleCardState);
        break;
      case "frequencyRange":
        workingPool = workingPool.filter((candidate) =>
          settingsApi.evaluateRuleCardMetric(ruleCardState, candidate.transitionCount)
        );
        break;
      default:
        break;
    }
  }

  return workingPool;
}

function applyHighFrequencyRankRule(candidatePool, ruleCardState) {
  const rankedPool = [...candidatePool].sort(comparePreloadCandidateFrequency);
  const rankByUrl = new Map(
    rankedPool.map((candidate, index) => [candidate.url, index + 1])
  );

  return candidatePool.filter((candidate) =>
    settingsApi.evaluateRuleCardMetric(ruleCardState, rankByUrl.get(candidate.url))
  );
}

function comparePreloadCandidateFrequency(left, right) {
  if (right.transitionCount !== left.transitionCount) {
    return right.transitionCount - left.transitionCount;
  }

  return comparePreloadCandidatePriority(left, right);
}

function comparePreloadCandidatePriority(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.visibilityScore !== left.visibilityScore) {
    return right.visibilityScore - left.visibilityScore;
  }

  return left.linkIndex - right.linkIndex;
}

function buildDebugSnapshot(graph) {
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges).sort(
    (left, right) => getEdgeTotalCount(right) - getEdgeTotalCount(left)
  );

  return {
    version: graph.version,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    transitionMessageCount: Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages.length
      : 0,
    updatedAt: graph.updatedAt,
    transitionSequence: graph.transitionSequence ?? 0,
    topNodes: nodes
      .sort((left, right) => right.visitCount - left.visitCount)
      .slice(0, 10),
    topEdges: edges.slice(0, 10),
    recentTransitions: getRecentTransitionPreview(graph),
  };
}

function createEmptyGraph() {
  return {
    version: 6,
    nodes: {},
    edges: {},
    transitionBuckets: createEmptyTransitionBuckets(),
    transitionMessageBuckets: createEmptyTransitionMessageBuckets(),
    pageTransitionBuckets: createEmptyPageTransitionBuckets(),
    pageTransitionMessageBuckets: createEmptyPageTransitionMessageBuckets(),
    transitionMessages: [],
    transitionSequence: 0,
    updatedAt: null,
  };
}

function createEmptyTransitionBuckets() {
  return Object.fromEntries(
    TRANSITION_WINDOW_KEYS.map((windowKey) => [windowKey, createEmptyBucketLayer()])
  );
}

function createEmptyBucketLayer() {
  return Array.from({ length: OUTBOUND_BUCKET_COUNT }, () => ({}));
}

function createEmptyTransitionMessageBuckets() {
  return {
    buckets: createEmptyBucketLayer(),
  };
}

function createEmptyPageTransitionBuckets() {
  return Object.fromEntries(
    TRANSITION_WINDOW_KEYS.map((windowKey) => [windowKey, createEmptyPageBucketLayer()])
  );
}

function createEmptyPageTransitionMessageBuckets() {
  return {
    buckets: createEmptyPageBucketLayer(),
  };
}

function createEmptyPageBucketLayer() {
  return Array.from({ length: OUTBOUND_BUCKET_COUNT }, () => ({}));
}

function createEmptyTransitionStats() {
  return {
    total: 0,
    last365d: 0,
    last30d: 0,
    last7d: 0,
    last1d: 0,
  };
}

function normalizeTrackingGraph(rawGraph) {
  const graph = isPlainObject(rawGraph) ? rawGraph : createEmptyGraph();
  const storedVersion = clampNonNegativeInt(graph.version, 0);
  const storedEdgeSnapshots = captureStoredEdgeSnapshots(graph.edges);
  const storedTransitionMessageBucketLayer = getStoredTransitionMessageBucketLayer(
    graph.transitionMessageBuckets
  );
  graph.version = 6;
  graph.nodes = isPlainObject(graph.nodes) ? graph.nodes : {};
  graph.edges = isPlainObject(graph.edges) ? graph.edges : {};
  graph.transitionMessages = normalizeTransitionMessages(
    Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages
      : Array.isArray(graph.recentTransitions)
        ? graph.recentTransitions.slice().reverse()
        : []
  );
  graph.transitionSequence = Math.max(
    clampNonNegativeInt(graph.transitionSequence, 0),
    getMaxTransitionSequence(graph.transitionMessages)
  );
  graph.updatedAt = typeof graph.updatedAt === "string" ? graph.updatedAt : null;

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    normalizeEdgeRecord(graph, edgeId, edge);
  }

  reconcileStartupTransitionCoverage(
    graph,
    storedVersion,
    storedEdgeSnapshots,
    storedTransitionMessageBucketLayer
  );

  graph.transitionBuckets = createEmptyTransitionBuckets();
  graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
  graph.pageTransitionBuckets = createEmptyPageTransitionBuckets();
  graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();

  for (const edge of Object.values(graph.edges)) {
    registerEdgeInTransitionBuckets(graph, edge);
  }

  for (const transitionMessage of graph.transitionMessages) {
    registerTransitionMessageInBuckets(graph, transitionMessage);
    registerTransitionMessageInPageIndexes(graph, transitionMessage);
  }

  delete graph.recentTransitions;

  return graph;
}

function normalizeTransitionMessages(rawMessages) {
  const nextMessages = rawMessages
    .filter((message) => isPlainObject(message))
    .map((message, index) => normalizeTransitionMessageRecord(message, index))
    .sort(compareTransitionMessages);

  let nextSequence = 0;

  for (const transitionMessage of nextMessages) {
    if (transitionMessage.sequenceNumber <= nextSequence) {
      nextSequence += 1;
      transitionMessage.sequenceNumber = nextSequence;
      continue;
    }

    nextSequence = transitionMessage.sequenceNumber;
  }

  return nextMessages;
}

function normalizeTransitionMessageRecord(message, fallbackIndex) {
  const toPageUrl = normalizePageUrlForIndex(
    typeof message.toPageUrl === "string" ? message.toPageUrl : message.url
  );

  return {
    sequenceNumber: clampNonNegativeInt(message.sequenceNumber, fallbackIndex + 1),
    fromNodeId: typeof message.fromNodeId === "string" ? message.fromNodeId : null,
    toNodeId: typeof message.toNodeId === "string" ? message.toNodeId : "",
    fromHost: typeof message.fromHost === "string" ? message.fromHost : null,
    toHost: typeof message.toHost === "string" ? message.toHost : "",
    fromPageUrl: normalizePageUrlForIndex(message.fromPageUrl || ""),
    toPageUrl: toPageUrl || "",
    tabId: Number.isFinite(Number(message.tabId)) ? Number(message.tabId) : -1,
    occurredAt: typeof message.occurredAt === "string" ? message.occurredAt : "",
    eventType: typeof message.eventType === "string" ? message.eventType : "unknown",
    transitionType:
      typeof message.transitionType === "string" ? message.transitionType : "unknown",
    url: toPageUrl || (typeof message.url === "string" ? message.url : ""),
  };
}

function compareTransitionMessages(left, right) {
  if (left.sequenceNumber !== right.sequenceNumber) {
    return left.sequenceNumber - right.sequenceNumber;
  }

  return String(left.occurredAt).localeCompare(String(right.occurredAt));
}

function getMaxTransitionSequence(transitionMessages) {
  return transitionMessages.reduce(
    (maxSequence, transitionMessage) =>
      Math.max(maxSequence, clampNonNegativeInt(transitionMessage.sequenceNumber, 0)),
    0
  );
}

function getRecentTransitionPreview(graph) {
  return Array.isArray(graph.transitionMessages)
    ? graph.transitionMessages.slice(-MAX_DEBUG_TRANSITIONS).reverse()
    : [];
}

function getStoredTransitionMessageBucketLayer(rawTransitionMessageBuckets) {
  if (Array.isArray(rawTransitionMessageBuckets)) {
    return rawTransitionMessageBuckets;
  }

  if (Array.isArray(rawTransitionMessageBuckets?.buckets)) {
    return rawTransitionMessageBuckets.buckets;
  }

  return null;
}

function getTransitionMessageBucketLayer(graph) {
  if (!Array.isArray(graph.transitionMessageBuckets?.buckets)) {
    graph.transitionMessageBuckets = createEmptyTransitionMessageBuckets();
  }

  return graph.transitionMessageBuckets.buckets;
}

function reconcileStartupTransitionCoverage(
  graph,
  storedVersion,
  storedEdgeSnapshots,
  storedTransitionMessageBucketLayer
) {
  if (storedVersion < 5 || !Array.isArray(storedTransitionMessageBucketLayer)) {
    return;
  }

  const recentMessages = graph.transitionMessages.slice(-STARTUP_SYNC_MESSAGE_WINDOW);

  for (const transitionMessage of recentMessages) {
    if (
      !shouldReplayTransitionMessageFromStartupCheck(
        graph,
        storedEdgeSnapshots,
        storedTransitionMessageBucketLayer,
        transitionMessage
      )
    ) {
      continue;
    }

    replayTransitionMessageIntoEdgeCounts(graph, transitionMessage);
  }
}

function shouldReplayTransitionMessageFromStartupCheck(
  graph,
  storedEdgeSnapshots,
  storedTransitionMessageBucketLayer,
  transitionMessage
) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return false;
  }

  const edgeId = `${transitionMessage.fromNodeId} -> ${transitionMessage.toNodeId}`;
  const storedEdgeSnapshot = storedEdgeSnapshots.get(edgeId) ?? null;

  if (!storedEdgeSnapshot) {
    return true;
  }

  if (
    hasStoredTransitionMessageReference(
      graph,
      storedTransitionMessageBucketLayer,
      transitionMessage
    )
  ) {
    return false;
  }

  return isOccurredAfter(
    transitionMessage.occurredAt,
    storedEdgeSnapshot.lastSeenAt
  );
}

function captureStoredEdgeSnapshots(rawEdges) {
  const snapshots = new Map();

  if (!isPlainObject(rawEdges)) {
    return snapshots;
  }

  for (const [edgeId, edge] of Object.entries(rawEdges)) {
    snapshots.set(edgeId, {
      lastSeenAt: typeof edge?.lastSeenAt === "string" ? edge.lastSeenAt : null,
    });
  }

  return snapshots;
}

function isOccurredAfter(leftOccurredAt, rightOccurredAt) {
  const left = Date.parse(leftOccurredAt || "");
  const right = Date.parse(rightOccurredAt || "");

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }

  return left > right;
}

function hasStoredTransitionMessageReference(
  graph,
  storedTransitionMessageBucketLayer,
  transitionMessage
) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return false;
  }

  const sourceMessages =
    storedTransitionMessageBucketLayer[getSourceBucketIndex(graph, transitionMessage.fromNodeId)]?.[
      transitionMessage.fromNodeId
    ]?.[transitionMessage.toNodeId];

  return Array.isArray(sourceMessages)
    ? sourceMessages.includes(transitionMessage.sequenceNumber)
    : false;
}

function normalizeEdgeRecord(graph, edgeId, edge) {
  if (!isPlainObject(edge)) {
    graph.edges[edgeId] = edge = {};
  }

  edge.edgeId = edge.edgeId || edgeId;
  edge.fromNodeId = edge.fromNodeId || edgeId.split(" -> ")[0] || "";
  edge.toNodeId = edge.toNodeId || edgeId.split(" -> ")[1] || "";
  edge.fromHost = edge.fromHost || graph.nodes[edge.fromNodeId]?.host || edge.fromNodeId;
  edge.toHost = edge.toHost || graph.nodes[edge.toNodeId]?.host || edge.toNodeId;
  edge.count = clampNonNegativeInt(edge.count ?? edge.transitionStats?.total, 0);
  edge.firstSeenAt = typeof edge.firstSeenAt === "string" ? edge.firstSeenAt : edge.lastSeenAt || null;
  edge.lastSeenAt = typeof edge.lastSeenAt === "string" ? edge.lastSeenAt : edge.firstSeenAt || null;
  edge.lastTransitionType =
    typeof edge.lastTransitionType === "string" ? edge.lastTransitionType : "unknown";

  const seededDailyCounts = isPlainObject(edge.dailyCounts)
    ? edge.dailyCounts
    : seedLegacyEdgeDailyCounts(edge);
  edge.dailyCounts = normalizeDailyCounts(seededDailyCounts);
  recalculateEdgeTransitionStats(edge, edge.lastSeenAt || edge.firstSeenAt || new Date().toISOString());
}

function seedLegacyEdgeDailyCounts(edge) {
  if (!edge.count) {
    return {};
  }

  return {
    [buildUtcDayKey(edge.lastSeenAt || edge.firstSeenAt || new Date().toISOString())]: edge.count,
  };
}

function normalizeDailyCounts(rawDailyCounts) {
  const nextDailyCounts = {};

  for (const [dayKey, count] of Object.entries(rawDailyCounts)) {
    const normalizedCount = clampNonNegativeInt(count, 0);

    if (!isValidDayKey(dayKey) || normalizedCount <= 0) {
      continue;
    }

    nextDailyCounts[dayKey] = normalizedCount;
  }

  return nextDailyCounts;
}

function recalculateEdgeTransitionStats(edge, referenceOccurredAt) {
  const referenceDay = dayKeyToEpochDay(buildUtcDayKey(referenceOccurredAt));
  const nextDailyCounts = {};
  const nextStats = createEmptyTransitionStats();

  nextStats.total = clampNonNegativeInt(edge.count, 0);

  for (const [dayKey, count] of Object.entries(edge.dailyCounts || {})) {
    const normalizedCount = clampNonNegativeInt(count, 0);
    const dayNumber = dayKeyToEpochDay(dayKey);

    if (normalizedCount <= 0 || dayNumber === null) {
      continue;
    }

    const ageInDays = Math.max(0, referenceDay - dayNumber);

    if (ageInDays <= 364) {
      nextDailyCounts[dayKey] = normalizedCount;
      nextStats.last365d += normalizedCount;
    }

    if (ageInDays <= 29) {
      nextStats.last30d += normalizedCount;
    }

    if (ageInDays <= 6) {
      nextStats.last7d += normalizedCount;
    }

    if (ageInDays === 0) {
      nextStats.last1d += normalizedCount;
    }
  }

  edge.dailyCounts = nextDailyCounts;
  edge.transitionStats = nextStats;
}

function registerEdgeInTransitionBuckets(graph, edge) {
  if (!edge?.fromNodeId || !edge?.toNodeId || !edge?.edgeId) {
    return;
  }

  for (const windowKey of TRANSITION_WINDOW_KEYS) {
    setTransitionBucketCount(
      graph.transitionBuckets[windowKey],
      graph,
      edge.fromNodeId,
      edge.toNodeId,
      getTransitionWindowCount(edge, windowKey)
    );
  }
}

function setTransitionBucketCount(bucketLayer, graph, sourceNodeId, targetNodeId, count) {
  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap = bucket[sourceNodeId] || (bucket[sourceNodeId] = {});

  if (count > 0) {
    sourceMap[targetNodeId] = count;
    return;
  }

  delete sourceMap[targetNodeId];

  if (!Object.keys(sourceMap).length) {
    delete bucket[sourceNodeId];
  }
}

function getTransitionWindowCount(edge, windowKey) {
  if (windowKey === "total") {
    return getEdgeTotalCount(edge);
  }

  return clampNonNegativeInt(edge?.transitionStats?.[windowKey], 0);
}

function getTransitionCount(graph, windowKey, sourceNodeId, targetNodeId) {
  return clampNonNegativeInt(
    graph.transitionBuckets?.[windowKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[sourceNodeId]?.[
      targetNodeId
    ],
    0
  );
}

function getTransitionMapForSource(graph, windowKey, sourceNodeId) {
  return (
    graph.transitionBuckets?.[windowKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[sourceNodeId] ??
    {}
  );
}

function getOutgoingEdgeEntriesForNode(graph, sourceNodeId) {
  return Object.entries(getTransitionMapForSource(graph, "total", sourceNodeId)).map(
    ([destinationNodeId, count]) => ({
      edge: graph.edges[`${sourceNodeId} -> ${destinationNodeId}`] ?? null,
      destinationNodeId,
      count: clampNonNegativeInt(count, 0),
    })
  );
}

function registerTransitionMessageInBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.sequenceNumber
  ) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, transitionMessage.fromNodeId);
  const bucketLayer = getTransitionMessageBucketLayer(graph);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceMap =
    bucket[transitionMessage.fromNodeId] || (bucket[transitionMessage.fromNodeId] = {});
  const targetMessages =
    sourceMap[transitionMessage.toNodeId] || (sourceMap[transitionMessage.toNodeId] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

function registerTransitionMessageInPageIndexes(graph, transitionMessage) {
  registerPageTransitionCountBuckets(graph, transitionMessage);
  registerPageTransitionMessageBuckets(graph, transitionMessage);
}

function registerPageTransitionCountBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.fromPageUrl ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.toPageUrl
  ) {
    return;
  }

  for (const windowKey of getTransitionMessageWindowKeys(transitionMessage.occurredAt)) {
    incrementPageTransitionBucketCount(
      graph.pageTransitionBuckets[windowKey],
      graph,
      transitionMessage.fromNodeId,
      transitionMessage.fromPageUrl,
      transitionMessage.toNodeId,
      transitionMessage.toPageUrl,
      1
    );
  }
}

function registerPageTransitionMessageBuckets(graph, transitionMessage) {
  if (
    !transitionMessage?.fromNodeId ||
    !transitionMessage?.fromPageUrl ||
    !transitionMessage?.toNodeId ||
    !transitionMessage?.toPageUrl ||
    !transitionMessage?.sequenceNumber
  ) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, transitionMessage.fromNodeId);
  const bucketLayer = getPageTransitionMessageBucketLayer(graph);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceSiteMap =
    bucket[transitionMessage.fromNodeId] || (bucket[transitionMessage.fromNodeId] = {});
  const sourcePageMap =
    sourceSiteMap[transitionMessage.fromPageUrl] ||
    (sourceSiteMap[transitionMessage.fromPageUrl] = {});
  const targetSiteMap =
    sourcePageMap[transitionMessage.toNodeId] ||
    (sourcePageMap[transitionMessage.toNodeId] = {});
  const targetMessages =
    targetSiteMap[transitionMessage.toPageUrl] ||
    (targetSiteMap[transitionMessage.toPageUrl] = []);

  if (targetMessages[targetMessages.length - 1] !== transitionMessage.sequenceNumber) {
    targetMessages.push(transitionMessage.sequenceNumber);
  }
}

function getPageTransitionMessageBucketLayer(graph) {
  if (!Array.isArray(graph.pageTransitionMessageBuckets?.buckets)) {
    graph.pageTransitionMessageBuckets = createEmptyPageTransitionMessageBuckets();
  }

  return graph.pageTransitionMessageBuckets.buckets;
}

function incrementPageTransitionBucketCount(
  bucketLayer,
  graph,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl,
  delta
) {
  if (!Array.isArray(bucketLayer) || !sourceNodeId || !sourcePageUrl || !targetNodeId || !targetPageUrl) {
    return;
  }

  const bucketIndex = getSourceBucketIndex(graph, sourceNodeId);
  const bucket = bucketLayer[bucketIndex] || (bucketLayer[bucketIndex] = {});
  const sourceSiteMap = bucket[sourceNodeId] || (bucket[sourceNodeId] = {});
  const sourcePageMap = sourceSiteMap[sourcePageUrl] || (sourceSiteMap[sourcePageUrl] = {});
  const targetSiteMap = sourcePageMap[targetNodeId] || (sourcePageMap[targetNodeId] = {});
  targetSiteMap[targetPageUrl] = clampNonNegativeInt(targetSiteMap[targetPageUrl], 0) + delta;
}

function getPageTransitionCount(
  graph,
  windowKey,
  sourceNodeId,
  sourcePageUrl,
  targetNodeId,
  targetPageUrl
) {
  if (!sourceNodeId || !sourcePageUrl || !targetNodeId || !targetPageUrl) {
    return 0;
  }

  return clampNonNegativeInt(
    graph.pageTransitionBuckets?.[windowKey]?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[sourcePageUrl]?.[targetNodeId]?.[targetPageUrl],
    0
  );
}

function getOutgoingPageEntriesForSource(graph, sourceNodeId, sourcePageUrl) {
  const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || "");

  if (!sourceNodeId || !normalizedSourcePageUrl) {
    return [];
  }

  const sourcePageMap =
    graph.pageTransitionBuckets?.total?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[normalizedSourcePageUrl] ?? {};
  const outgoingEntries = [];

  for (const [destinationNodeId, destinationPages] of Object.entries(sourcePageMap)) {
    for (const [destinationPageUrl, count] of Object.entries(destinationPages || {})) {
      outgoingEntries.push({
        destinationNodeId,
        destinationPageUrl,
        destinationLabel: derivePageLabel(destinationPageUrl),
        destinationHost: graph.nodes[destinationNodeId]?.host ?? destinationNodeId,
        count: clampNonNegativeInt(count, 0),
        lastSeenAt: getLastSeenAtForPageTransition(
          graph,
          sourceNodeId,
          normalizedSourcePageUrl,
          destinationNodeId,
          destinationPageUrl
        ),
        lastTransitionType: getLastTransitionTypeForPageTransition(
          graph,
          sourceNodeId,
          normalizedSourcePageUrl,
          destinationNodeId,
          destinationPageUrl
        ),
      });
    }
  }

  return outgoingEntries;
}

function getLastSeenAtForPageTransition(
  graph,
  sourceNodeId,
  sourcePageUrl,
  destinationNodeId,
  destinationPageUrl
) {
  const sequenceNumbers =
    graph.pageTransitionMessageBuckets?.buckets?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[sourcePageUrl]?.[destinationNodeId]?.[destinationPageUrl] ?? [];
  const latestSequence = Array.isArray(sequenceNumbers)
    ? sequenceNumbers[sequenceNumbers.length - 1]
    : null;

  if (!latestSequence) {
    return null;
  }

  const recentMessage = graph.transitionMessages.find(
    (transitionMessage) => transitionMessage.sequenceNumber === latestSequence
  );
  return recentMessage?.occurredAt ?? null;
}

function getLastTransitionTypeForPageTransition(
  graph,
  sourceNodeId,
  sourcePageUrl,
  destinationNodeId,
  destinationPageUrl
) {
  const sequenceNumbers =
    graph.pageTransitionMessageBuckets?.buckets?.[getSourceBucketIndex(graph, sourceNodeId)]?.[
      sourceNodeId
    ]?.[sourcePageUrl]?.[destinationNodeId]?.[destinationPageUrl] ?? [];
  const latestSequence = Array.isArray(sequenceNumbers)
    ? sequenceNumbers[sequenceNumbers.length - 1]
    : null;

  if (!latestSequence) {
    return "unknown";
  }

  const recentMessage = graph.transitionMessages.find(
    (transitionMessage) => transitionMessage.sequenceNumber === latestSequence
  );
  return recentMessage?.transitionType ?? "unknown";
}

function derivePageLabel(pageUrl) {
  try {
    const parsedUrl = new URL(pageUrl);
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    return `${parsedUrl.host}${path}${parsedUrl.search}` || pageUrl;
  } catch (_error) {
    return pageUrl;
  }
}

function getTransitionMessageWindowKeys(occurredAt) {
  const occurredDay = dayKeyToEpochDay(buildUtcDayKey(occurredAt));
  const referenceDay = dayKeyToEpochDay(buildUtcDayKey(new Date().toISOString()));

  if (occurredDay === null || referenceDay === null) {
    return ["total"];
  }

  const ageInDays = Math.max(0, referenceDay - occurredDay);
  const windowKeys = ["total"];

  if (ageInDays <= 364) {
    windowKeys.push("last365d");
  }

  if (ageInDays <= 29) {
    windowKeys.push("last30d");
  }

  if (ageInDays <= 6) {
    windowKeys.push("last7d");
  }

  if (ageInDays === 0) {
    windowKeys.push("last1d");
  }

  return windowKeys;
}

function createTransitionMessageRecord(
  graph,
  event,
  previousNodeId,
  previousPageUrl,
  targetNodeId
) {
  const targetPageUrl = normalizePageUrlForIndex(event.url);

  return {
    sequenceNumber: graph.transitionSequence,
    fromNodeId: previousNodeId,
    toNodeId: targetNodeId,
    fromHost: previousNodeId ? graph.nodes[previousNodeId]?.host ?? previousNodeId : null,
    toHost: graph.nodes[targetNodeId]?.host ?? targetNodeId,
    fromPageUrl: previousPageUrl,
    toPageUrl: targetPageUrl || "",
    tabId: Number(event.tabId),
    occurredAt: event.occurredAt,
    eventType: event.eventType,
    transitionType: event.transitionType,
    url: targetPageUrl || event.url,
  };
}

function appendTransitionMessage(graph, transitionMessage) {
  graph.transitionMessages.push(transitionMessage);
}

function replayTransitionMessageIntoEdgeCounts(graph, transitionMessage) {
  if (!transitionMessage?.fromNodeId || !transitionMessage?.toNodeId) {
    return;
  }

  upsertEdgeFallback(
    graph,
    transitionMessage.fromNodeId,
    transitionMessage.toNodeId,
    transitionMessage.occurredAt,
    transitionMessage.transitionType
  );
}

function applyTransitionMessageToIndexes(graph, transitionMessage) {
  replayTransitionMessageIntoEdgeCounts(graph, transitionMessage);
  registerTransitionMessageInBuckets(graph, transitionMessage);
  registerTransitionMessageInPageIndexes(graph, transitionMessage);
}

function getSourceBucketIndex(graph, sourceNodeId) {
  const bucketText = deriveBucketText(graph, sourceNodeId);
  const firstChar = normalizeBucketChar(bucketText[0]);
  const secondChar = bucketText.length > 1 ? normalizeBucketChar(bucketText[1]) : "";
  const firstIndex = getBucketCharIndex(firstChar);
  const secondIndex =
    secondChar === "" ? BUCKET_SECONDARY_BLANK_INDEX : getBucketCharIndex(secondChar);

  return firstIndex * (BUCKET_PRIMARY_CHARSET.length + 1) + secondIndex;
}

function deriveBucketText(graph, sourceNodeId) {
  const node = graph.nodes?.[sourceNodeId];
  const rawText =
    node?.hostname ||
    node?.host ||
    sourceNodeId ||
    "";

  return rawText.toLowerCase().replace(/^www\./, "");
}

function normalizeBucketChar(character) {
  const normalized = String(character || "").toLowerCase();
  return BUCKET_PRIMARY_CHARSET.includes(normalized) ? normalized : "_";
}

function getBucketCharIndex(character) {
  const index = BUCKET_PRIMARY_CHARSET.indexOf(normalizeBucketChar(character));
  return index >= 0 ? index : BUCKET_PRIMARY_CHARSET.length - 1;
}

function getEdgeTotalCount(edge) {
  return clampNonNegativeInt(edge?.transitionStats?.total ?? edge?.count, 0);
}

function buildUtcDayKey(occurredAt) {
  if (typeof occurredAt === "string" && isValidDayKey(occurredAt.slice(0, 10))) {
    return occurredAt.slice(0, 10);
  }

  const parsed = new Date(occurredAt || Date.now());
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function isValidDayKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayKeyToEpochDay(dayKey) {
  if (!isValidDayKey(dayKey)) {
    return null;
  }

  const [year, month, day] = dayKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function clampNonNegativeInt(value, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.round(numericValue));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createEmptyPreloadState() {
  return {
    windowId: null,
    entriesBySourceTab: {},
    prerenderEntriesBySourceTab: {},
    prefetchEntriesBySourceTab: {},
    updatedAt: null,
  };
}

function buildPageContext(trackingState, preloadState, tabId, pageUrl) {
  const numericTabId = Number(tabId);
  const trackable = isTrackableUrl(pageUrl || "");
  const normalizedPageUrl = normalizePageUrlForIndex(pageUrl || "");
  const nodeId =
    trackingState.tabState[String(tabId)]?.nodeId ??
    (trackable ? buildNodeSeed(pageUrl).nodeId : null);

  return {
    tabId: Number.isFinite(numericTabId) ? numericTabId : null,
    pageUrl: normalizedPageUrl || pageUrl || null,
    nodeId,
    pageLabel: normalizedPageUrl ? derivePageLabel(normalizedPageUrl) : "Untracked page",
    trackable,
    hasPreloadWindow: Boolean(preloadState.windowId),
  };
}

function buildCurrentTopDestinations(graph, nodeId, pageUrl) {
  if (!nodeId) {
    return [];
  }

  const pageEntries = getOutgoingPageEntriesForSource(graph, nodeId, pageUrl);
  const outgoingEntries =
    pageEntries.length > 0
      ? pageEntries
      : getOutgoingEdgeEntriesForNode(graph, nodeId).map(
          ({ edge, destinationNodeId, count }) => ({
            destinationNodeId,
            destinationPageUrl: edge?.toHost ?? destinationNodeId,
            count,
            lastSeenAt: edge?.lastSeenAt ?? null,
            lastTransitionType: edge?.lastTransitionType ?? "unknown",
            destinationLabel: deriveNodeLabel(destinationNodeId),
            destinationHost: edge?.toHost ?? destinationNodeId,
          })
        );

  return outgoingEntries
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
    .map((entry) => ({
      destinationNodeId: entry.destinationNodeId,
      destinationPageUrl: entry.destinationPageUrl ?? null,
      destinationLabel: entry.destinationLabel,
      destinationHost: entry.destinationHost,
      count: entry.count,
      lastSeenAt: entry.lastSeenAt ?? null,
      lastTransitionType: entry.lastTransitionType ?? "unknown",
    }));
}

function buildCurrentPreloads(preloadState, tabId) {
  const hiddenTabEntries = Object.values(preloadState.entriesBySourceTab[String(tabId)] ?? {}).map(
    (entry) => ({
      requestedUrl: entry.requestedUrl,
      loadedUrl: entry.loadedUrl,
      score: entry.score,
      status: entry.status,
      strategy: "hidden-tab",
      nodeLabel: deriveNodeLabel(entry.nodeId),
    })
  );
  const prerenderEntries = Object.values(
    preloadState.prerenderEntriesBySourceTab[String(tabId)] ?? {}
  ).map((entry) => ({
    requestedUrl: entry.requestedUrl,
    loadedUrl: entry.requestedUrl,
    score: entry.score,
    status: entry.status,
    strategy: "prerender",
    nodeLabel: derivePageLabel(entry.requestedUrl),
  }));
  const prefetchEntries = Object.values(
    preloadState.prefetchEntriesBySourceTab[String(tabId)] ?? {}
  ).map((entry) => ({
    requestedUrl: entry.requestedUrl,
    loadedUrl: entry.requestedUrl,
    score: entry.score,
    status: entry.status,
    strategy: "prefetch",
    nodeLabel: derivePageLabel(entry.requestedUrl),
  }));

  return [...prerenderEntries, ...prefetchEntries, ...hiddenTabEntries]
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => ({
      requestedUrl: entry.requestedUrl,
      loadedUrl: entry.loadedUrl,
      score: entry.score,
      status: entry.status,
      strategy: entry.strategy,
      nodeLabel: entry.nodeLabel,
    }));
}

async function applyTrackingEvent(state, event) {
  const engine = await getVisitGraphEngine();

  if (!engine) {
    return applyTrackingEventFallback(state, event);
  }

  try {
    return engine.applyEvent(state, event);
  } catch (error) {
    console.error("Wasm visit graph engine failed, falling back to JS.", error);
    return applyTrackingEventFallback(state, event);
  }
}

async function getVisitGraphEngine() {
  if (visitGraphEnginePromise === null) {
    visitGraphEnginePromise = createVisitGraphEngine().catch((error) => {
      console.error("Failed to load visit graph wasm engine.", error);
      return null;
    });
  }

  return visitGraphEnginePromise;
}

async function createVisitGraphEngine() {
  const response = await fetch(chrome.runtime.getURL(WASM_ENGINE_PATH));

  if (!response.ok) {
    throw new Error(`Wasm engine fetch failed with status ${response.status}.`);
  }

  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());

  if (!instance?.exports?.memory) {
    throw new Error("Wasm engine did not expose linear memory.");
  }

  console.log("Visit graph wasm engine loaded.");
  return wrapVisitGraphEngine(instance.exports);
}

function wrapVisitGraphEngine(exports) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  return {
    applyEvent(state, event) {
      const stateInput = writeJsonToWasm(exports, textEncoder, state);
      const eventInput = writeJsonToWasm(exports, textEncoder, event);

      try {
        const resultPointer = exports.apply_event_json(
          stateInput.pointer,
          stateInput.length,
          eventInput.pointer,
          eventInput.length
        );
        const result = readJsonFromWasm(exports, textDecoder, resultPointer);

        if (!result?.ok) {
          throw new Error(result?.error || "Wasm engine returned an unknown error.");
        }

        return result.state;
      } finally {
        freeInputBuffer(exports, stateInput);
        freeInputBuffer(exports, eventInput);
      }
    },
  };
}

function writeJsonToWasm(exports, textEncoder, value) {
  const bytes = textEncoder.encode(JSON.stringify(value));
  const pointer = bytes.length ? exports.alloc(bytes.length) : 0;

  if (bytes.length) {
    new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
  }

  return {
    pointer,
    length: bytes.length,
  };
}

function readJsonFromWasm(exports, textDecoder, pointer) {
  const length = exports.last_result_len();
  const bytes = length
    ? new Uint8Array(exports.memory.buffer.slice(pointer, pointer + length))
    : new Uint8Array();
  const jsonText = textDecoder.decode(bytes);

  if (length) {
    exports.free_result(pointer, length);
  }

  return JSON.parse(jsonText);
}

function freeInputBuffer(exports, buffer) {
  if (buffer.pointer && buffer.length) {
    exports.dealloc(buffer.pointer, buffer.length);
  }
}

function applyTrackingEventFallback(state, event) {
  switch (event.type) {
    case "record-visit":
      return applyRecordVisitFallback(state, event);
    case "record-created-navigation-target":
      return applyRecordCreatedNavigationTargetFallback(state, event);
    case "record-tab-replacement":
      return applyRecordTabReplacementFallback(state, event);
    case "remove-tab":
      delete state.tabState[event.tabId];
      delete state.pendingSources[event.tabId];
      return state;
    default:
      throw new Error(`Unsupported visit graph event type: ${event.type}`);
  }
}

function applyRecordVisitFallback(state, event) {
  const tabId = event.tabId;
  const targetNodeId = event.targetNode.nodeId;
  const previousNodeId =
    state.pendingSources[tabId]?.nodeId ?? state.tabState[tabId]?.nodeId ?? null;
  const previousPageUrl =
    normalizePageUrlForIndex(state.pendingSources[tabId]?.pageUrl || "") ??
    normalizePageUrlForIndex(state.tabState[tabId]?.url || "");
  const isNewNodeVisit = previousNodeId === null || previousNodeId !== targetNodeId;

  upsertNodeFallback(state.graph, event.targetNode, event.occurredAt);

  if (isNewNodeVisit) {
    state.graph.nodes[targetNodeId].visitCount += 1;
    state.graph.transitionSequence = (state.graph.transitionSequence ?? 0) + 1;
    const transitionMessage = createTransitionMessageRecord(
      state.graph,
      event,
      previousNodeId,
      previousPageUrl,
      targetNodeId
    );
    appendTransitionMessage(state.graph, transitionMessage);
    applyTransitionMessageToIndexes(state.graph, transitionMessage);
  }

  state.graph.updatedAt = event.occurredAt;
  state.tabState[tabId] = {
    nodeId: targetNodeId,
    url: event.url,
    updatedAt: event.occurredAt,
  };
  delete state.pendingSources[tabId];

  return state;
}

function applyRecordCreatedNavigationTargetFallback(state, event) {
  const sourceNodeId = state.tabState[event.sourceTabId]?.nodeId;

  if (!sourceNodeId) {
    return state;
  }

  state.pendingSources[event.targetTabId] = {
    nodeId: sourceNodeId,
    pageUrl: normalizePageUrlForIndex(state.tabState[event.sourceTabId]?.url || ""),
    createdAt: event.occurredAt,
  };

  return state;
}

function applyRecordTabReplacementFallback(state, event) {
  if (state.tabState[event.replacedTabId]) {
    state.tabState[event.newTabId] = state.tabState[event.replacedTabId];
    delete state.tabState[event.replacedTabId];
  }

  if (state.pendingSources[event.replacedTabId]) {
    state.pendingSources[event.newTabId] = state.pendingSources[event.replacedTabId];
    delete state.pendingSources[event.replacedTabId];
  }

  return state;
}

function upsertNodeFallback(graph, targetNode, occurredAt) {
  if (!graph.nodes[targetNode.nodeId]) {
    graph.nodes[targetNode.nodeId] = {
      nodeId: targetNode.nodeId,
      origin: targetNode.origin,
      host: targetNode.host,
      hostname: targetNode.hostname,
      protocol: targetNode.protocol,
      sampleUrl: targetNode.sampleUrl,
      visitCount: 0,
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
    };

    return;
  }

  graph.nodes[targetNode.nodeId].lastSeenAt = occurredAt;
  graph.nodes[targetNode.nodeId].sampleUrl = targetNode.sampleUrl;
}

function upsertEdgeFallback(graph, fromNodeId, toNodeId, occurredAt, transitionType) {
  const edgeId = `${fromNodeId} -> ${toNodeId}`;

  if (!graph.edges[edgeId]) {
    graph.edges[edgeId] = {
      edgeId,
      fromNodeId,
      toNodeId,
      fromHost: graph.nodes[fromNodeId]?.host ?? fromNodeId,
      toHost: graph.nodes[toNodeId]?.host ?? toNodeId,
      count: 0,
      transitionStats: createEmptyTransitionStats(),
      dailyCounts: {},
      firstSeenAt: occurredAt,
      lastSeenAt: occurredAt,
      lastTransitionType: transitionType,
    };
  }

  const edge = graph.edges[edgeId];
  edge.count += 1;
  edge.lastSeenAt = occurredAt;
  edge.lastTransitionType = transitionType;
  const dayKey = buildUtcDayKey(occurredAt);
  edge.dailyCounts[dayKey] = clampNonNegativeInt(edge.dailyCounts[dayKey], 0) + 1;
  recalculateEdgeTransitionStats(edge, occurredAt);
  registerEdgeInTransitionBuckets(graph, edge);
}

async function loadTrackingState() {
  const stored = await chrome.storage.local.get({
    [GRAPH_KEY]: createEmptyGraph(),
    [TAB_STATE_KEY]: {},
    [PENDING_SOURCE_KEY]: {},
  });

  return {
    graph: normalizeTrackingGraph(stored[GRAPH_KEY]),
    tabState: stored[TAB_STATE_KEY],
    pendingSources: stored[PENDING_SOURCE_KEY],
  };
}

async function saveTrackingState(state) {
  await chrome.storage.local.set({
    [GRAPH_KEY]: state.graph,
    [TAB_STATE_KEY]: state.tabState,
    [PENDING_SOURCE_KEY]: state.pendingSources,
  });
}

async function loadPreloadState() {
  const stored = await chrome.storage.local.get({
    [PRELOAD_STATE_KEY]: createEmptyPreloadState(),
  });

  return normalizePreloadState(stored[PRELOAD_STATE_KEY]);
}

async function initializeExtensionState() {
  const stored = await chrome.storage.local.get({
    [SETTINGS_STORAGE_KEY]: null,
    [GRAPH_KEY]: null,
    [TAB_STATE_KEY]: null,
    [PENDING_SOURCE_KEY]: null,
    [PRELOAD_STATE_KEY]: null,
  });

  cachedUserSettings = settingsApi.normalizeStoredSettings(stored[SETTINGS_STORAGE_KEY]);
  const normalizedGraph = normalizeTrackingGraph(stored[GRAPH_KEY]);

  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: cachedUserSettings,
    [GRAPH_KEY]: normalizedGraph,
    [TAB_STATE_KEY]: stored[TAB_STATE_KEY] ?? {},
    [PENDING_SOURCE_KEY]: stored[PENDING_SOURCE_KEY] ?? {},
    [PRELOAD_STATE_KEY]: normalizePreloadState(stored[PRELOAD_STATE_KEY]),
  });
}

async function ensurePreloadWindowWatchdog() {
  const runtimeSettings = getEffectiveExtensionSettings();
  const shouldRunWatchdog =
    runtimeSettings.preloading.enabled && runtimeSettings.preloadWindow.watchdogEnabled;

  if (!shouldRunWatchdog) {
    await chrome.alarms.clear(PRELOAD_WINDOW_WATCHDOG_ALARM);
    return;
  }

  const periodInMinutes = runtimeSettings.preloadWindow.watchdogIntervalSeconds / 60;

  await chrome.alarms.create(PRELOAD_WINDOW_WATCHDOG_ALARM, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });
}

async function savePreloadState(preloadState) {
  await chrome.storage.local.set({
    [PRELOAD_STATE_KEY]: normalizePreloadState(preloadState),
  });
}

function normalizePreloadState(rawState) {
  const nextState = isPlainObject(rawState) ? rawState : createEmptyPreloadState();

  return {
    windowId: Number.isFinite(Number(nextState.windowId)) ? Number(nextState.windowId) : null,
    entriesBySourceTab: isPlainObject(nextState.entriesBySourceTab)
      ? nextState.entriesBySourceTab
      : {},
    prerenderEntriesBySourceTab: isPlainObject(nextState.prerenderEntriesBySourceTab)
      ? nextState.prerenderEntriesBySourceTab
      : {},
    prefetchEntriesBySourceTab: isPlainObject(nextState.prefetchEntriesBySourceTab)
      ? nextState.prefetchEntriesBySourceTab
      : {},
    updatedAt: typeof nextState.updatedAt === "string" ? nextState.updatedAt : null,
  };
}

function normalizePageUrlForIndex(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch (_error) {
    return null;
  }
}

function isSameOriginUrl(leftUrl, rightUrl) {
  try {
    return new URL(leftUrl).origin === new URL(rightUrl).origin;
  } catch (_error) {
    return false;
  }
}

function buildNodeSeed(rawUrl) {
  const parsedUrl = new URL(rawUrl);
  const googleSearchNode = getEffectiveExtensionSettings().tracking.trackGoogleSearchPages
    ? getGoogleSearchNode(parsedUrl)
    : null;

  if (googleSearchNode) {
    return googleSearchNode;
  }

  return {
    nodeId: parsedUrl.origin,
    origin: parsedUrl.origin,
    host: parsedUrl.host,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol.replace(":", ""),
    sampleUrl: rawUrl,
  };
}

function getGoogleSearchNode(parsedUrl) {
  const isGoogleHost =
    parsedUrl.hostname === "google.com" ||
    parsedUrl.hostname === "www.google.com" ||
    parsedUrl.hostname.startsWith("google.") ||
    parsedUrl.hostname.startsWith("www.google.");
  const isSearchPath = parsedUrl.pathname === "/search";
  const hasQuery = parsedUrl.searchParams.has("q");

  if (!isGoogleHost || !isSearchPath || !hasQuery) {
    return null;
  }

  return {
    nodeId: `${parsedUrl.origin}/search`,
    origin: parsedUrl.origin,
    host: `${parsedUrl.host}/search`,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol.replace(":", ""),
    sampleUrl: parsedUrl.href,
  };
}

function isGoogleSearchNodeId(nodeId) {
  return /google\.[^/]+\/search$/.test(nodeId);
}

function isTrackableUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function normalizeNavigableUrl(rawUrl, baseUrl) {
  try {
    const parsedUrl = new URL(rawUrl, baseUrl);

    if (!isTrackableUrl(parsedUrl.href)) {
      return null;
    }

    const normalizedSourceUrl = new URL(baseUrl);
    normalizedSourceUrl.hash = "";
    const normalizedTargetUrl = new URL(parsedUrl.href);
    normalizedTargetUrl.hash = "";

    if (normalizedSourceUrl.href === normalizedTargetUrl.href) {
      return null;
    }

    return parsedUrl.href;
  } catch (_error) {
    return null;
  }
}

function deriveNodeLabel(nodeId) {
  if (!nodeId) {
    return "Unknown";
  }

  try {
    const url = new URL(nodeId);
    return url.pathname === "/search" ? `${url.host}/search` : url.host;
  } catch (_error) {
    return nodeId;
  }
}

function isPreloadTab(preloadState, tabId) {
  return findPreloadEntryByTabId(preloadState, tabId) !== null;
}

function findPreloadEntryByTabId(preloadState, tabId) {
  const targetTabId = Number(tabId);

  for (const [sourceTabId, entries] of Object.entries(preloadState.entriesBySourceTab)) {
    for (const [url, entry] of Object.entries(entries)) {
      if (entry.tabId === targetTabId) {
        return { sourceTabId, url, entry };
      }
    }
  }

  return null;
}

async function getTabMaybe(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

async function closeTabIfExists(tabId) {
  expectedPreloadTabRemovals.add(Number(tabId));

  try {
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    expectedPreloadTabRemovals.delete(Number(tabId));
    // The tab may already be gone.
  }
}

async function getWindowMaybe(windowId) {
  try {
    return await chrome.windows.get(windowId);
  } catch (_error) {
    return null;
  }
}

function toIsoTimestamp(timeStamp) {
  return new Date(timeStamp || Date.now()).toISOString();
}
