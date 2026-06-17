import { pageEval, swEval } from "./cdp-client.mjs";
import { sleep } from "./test-utils.mjs";

export async function requestCandidateRefresh(serviceWorker, tabId) {
  await swEval(serviceWorker, async ({ tabId }) => {
    await requestPreloadCandidateRefreshForTab(tabId);
    await requestPreloadCandidateRefreshForOpenTabs();
    return true;
  }, { tabId });
}

export async function getDebugSnapshot(serviceWorker, tabId) {
  return swEval(serviceWorker, async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    return globalThis.ZeroLatencyCoreMessages.handleDebugSnapshot({
      tabId,
      pageUrl: tab.url,
    });
  }, { tabId });
}

export async function getRuntimeOccupancy(serviceWorker, tabId) {
  return swEval(serviceWorker, async ({ tabId }) => {
    const preloadState = await loadPreloadState();
    const runtimeEntry = findSourceTabRuntime(preloadState, tabId);
    const sourceTabRuntime = runtimeEntry?.sourceTabRuntime || null;
    const preloadWindowId = runtimeEntry?.normalWindowRuntime?.preloadWindow?.windowId || null;
    const hiddenEntries = Object.values(sourceTabRuntime?.hiddenTabEntriesByUrl || {}).map(
      (entry) => ({
        requestedUrl: entry.requestedUrl,
        loadedUrl: entry.loadedUrl,
        score: entry.score,
        scoreBreakdown: entry.scoreBreakdown ?? null,
        bookmarkPreload: entry.bookmarkPreload ?? null,
        siteSelection: entry.siteSelection ?? null,
        status: entry.status,
      })
    );
    const preloadTabs = preloadWindowId
      ? await chrome.tabs.query({ windowId: preloadWindowId })
      : [];
    const sentinelUrl = PRELOAD_WINDOW_SENTINEL_URL;
    return {
      preloadWindowId,
      hiddenEntries,
      hiddenEntryCount: Object.keys(sourceTabRuntime?.hiddenTabEntriesByUrl || {}).length,
      prerenderEntryCount: Object.keys(sourceTabRuntime?.prerenderEntriesByUrl || {}).length,
      prefetchEntryCount: Object.keys(sourceTabRuntime?.prefetchEntriesByUrl || {}).length,
      preloadWindowTabUrls: preloadTabs.map((tab) => tab.url || ""),
      sentinelCount: preloadTabs.filter((tab) => (tab.url || "") === sentinelUrl).length,
      nonSentinelPreloadTabCount: preloadTabs.filter((tab) => (tab.url || "") !== sentinelUrl).length,
      knownRuntime: globalThis.snapshotKnownPreloadRuntime?.() || null,
    };
  }, { tabId });
}

export async function waitForRuntimeCondition(
  serviceWorker,
  tabId,
  predicate,
  timeoutMs = 12000
) {
  const startedAt = Date.now();
  let lastRuntime = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastRuntime = await getRuntimeOccupancy(serviceWorker, tabId);
    if (predicate(lastRuntime)) {
      return lastRuntime;
    }
    await requestCandidateRefresh(serviceWorker, tabId);
    await sleep(700);
  }

  return lastRuntime;
}

export async function waitForSnapshotCondition(
  serviceWorker,
  tabId,
  predicate,
  timeoutMs = 12000
) {
  const startedAt = Date.now();
  let lastSnapshot = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastSnapshot = await getDebugSnapshot(serviceWorker, tabId);
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await requestCandidateRefresh(serviceWorker, tabId);
    await sleep(700);
  }

  return lastSnapshot;
}

export async function waitForTabComplete(serviceWorker, tabId, timeoutMs = 12000) {
  const startedAt = Date.now();
  let lastStatus = null;

  while (Date.now() - startedAt < timeoutMs) {
    const status = await swEval(serviceWorker, async ({ tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      return { status: tab.status, url: tab.url };
    }, { tabId });
    lastStatus = status;
    if (status.status === "complete") {
      await sleep(700);
      return status;
    }
    await sleep(300);
  }

  throw new Error(
    `Timed out waiting for tab ${tabId} to complete: ${JSON.stringify(lastStatus)}`
  );
}

export async function waitForPageReady(page, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const readyState = await pageEval(page, () => document.readyState);
    if (readyState === "complete" || readyState === "interactive") {
      await sleep(300);
      return;
    }
    await sleep(200);
  }
  throw new Error("Timed out waiting for settings page readiness");
}
