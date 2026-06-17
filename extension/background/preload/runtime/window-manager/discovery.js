async function findReusablePreloadWindowId(
  preloadState,
  normalWindowId,
  sourceWindowIncognito = false
) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    return null;
  }

  const normalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);

  if (!normalWindowRuntime) {
    return null;
  }

  const candidateWindowCounts = new Map();

  for (const sourceTabRuntime of Object.values(normalWindowRuntime.sourceTabs || {})) {
    for (const entry of Object.values(
      getSourceTabPreloadChannelStore(sourceTabRuntime, "hiddenTab")
    )) {
      if (!Number.isFinite(entry?.tabId)) {
        continue;
      }

      const liveTab = await getTabMaybe(entry.tabId);

      if (
        liveTab?.windowId &&
        Number.isFinite(liveTab.windowId) &&
        preloadEntryMatchesLiveTab(entry, liveTab)
      ) {
        candidateWindowCounts.set(
          liveTab.windowId,
          (candidateWindowCounts.get(liveTab.windowId) ?? 0) + 1
        );
      }
    }
  }

  if (candidateWindowCounts.size === 0) {
    return null;
  }

  const candidateWindows = [];

  for (const [windowId, trackedTabCount] of candidateWindowCounts.entries()) {
    const candidateWindow = await getWindowMaybe(windowId);

    if (
      candidateWindow?.type !== "normal" ||
      candidateWindow.incognito !== sourceWindowIncognito
    ) {
      continue;
    }

    candidateWindows.push({
      windowId: candidateWindow.id,
      trackedTabCount,
      minimized: candidateWindow.state === "minimized",
      focused: candidateWindow.focused === true,
    });
  }

  candidateWindows.sort((left, right) => {
    if (right.trackedTabCount !== left.trackedTabCount) {
      return right.trackedTabCount - left.trackedTabCount;
    }

    if (left.focused !== right.focused) {
      return Number(left.focused) - Number(right.focused);
    }

    if (left.minimized !== right.minimized) {
      return Number(right.minimized) - Number(left.minimized);
    }

    return left.windowId - right.windowId;
  });

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.reuse-discovered", {
    normalWindowId,
    preloadWindowId: candidateWindows[0]?.windowId ?? null,
    candidateCount: candidateWindows.length,
    sourceIncognito: sourceWindowIncognito,
  });
  return candidateWindows[0]?.windowId ?? null;
}

async function isLivePreloadWindowForRuntime(normalWindowRuntime, windowId) {
  const normalizedWindowId = normalizePositiveInteger(windowId);

  if (normalizedWindowId === null) {
    return false;
  }

  let tabs = [];

  try {
    tabs = await chrome.tabs.query({ windowId: normalizedWindowId });
  } catch (_error) {
    return false;
  }

  if (tabs.some((tab) => tab.url === PRELOAD_WINDOW_SENTINEL_URL)) {
    return true;
  }

  const trackedEntries = Object.values(normalWindowRuntime?.sourceTabs || {})
    .flatMap((sourceTabRuntime) =>
      Object.values(getSourceTabPreloadChannelStore(sourceTabRuntime, "hiddenTab"))
    )
    .filter((entry) => normalizePositiveInteger(entry?.tabId) !== null);

  if (trackedEntries.length === 0) {
    return false;
  }

  const liveTabsById = new Map(tabs.map((tab) => [tab.id, tab]));

  return trackedEntries.some((entry) => {
    const liveTab = liveTabsById.get(entry.tabId);

    return liveTab ? preloadEntryMatchesLiveTab(entry, liveTab) : false;
  });
}

function preloadEntryMatchesLiveTab(entry, liveTab) {
  if (!entry || !liveTab) {
    return false;
  }

  const liveUrl = normalizePageUrlForIndex(liveTab.url || "");
  const requestedUrl = normalizePageUrlForIndex(entry.requestedUrl || "");
  const loadedUrl = normalizePageUrlForIndex(entry.loadedUrl || "");

  return Boolean(
    liveUrl &&
      ((requestedUrl && liveUrl === requestedUrl) || (loadedUrl && liveUrl === loadedUrl))
  );
}
