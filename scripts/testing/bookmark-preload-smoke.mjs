import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");
const outputRoot = path.join(repoRoot, "output", "playwright");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, `bookmark-preload-smoke-${runId}`);
const profileDir = path.join(runDir, "chrome-profile");
const extensionUnderTestDir = path.join(os.tmpdir(), `zlw-ext-smoke-${process.pid}-${Date.now()}`);

const chromePathCandidates = [
  path.join(process.env.LocalAppData || "", "ms-playwright", "chromium-1217", "chrome-win64", "chrome.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.LocalAppData || "", "Google", "Chrome", "Application", "chrome.exe"),
];

const TEST_HOSTS = [
  "www.google.com",
  "bookmark-high.test",
  "bookmark-mid.test",
  "bookmark-low.test",
  "page-result.test",
  "nongoogle.test",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await mkdir(runDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  await prepareExtensionUnderTest();

  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  const server = await startTestServer(webPort);
  const chrome = launchChrome({ webPort, debugPort });
  const clients = [];

  try {
    const serviceWorkerTarget = await waitForExtensionServiceWorker(debugPort);
    const extensionId = new URL(serviceWorkerTarget.url).host;
    const serviceWorker = serviceWorkerTarget.client;
    clients.push(serviceWorker);

    const settingsResult = await inspectSettingsPage({
      debugPort,
      serviceWorker,
      extensionId,
      clients,
    });

    const urls = buildTestUrls(webPort);
    await setupExtensionState(serviceWorker, urls);
    await waitForEffectiveTestSettings(serviceWorker);

    const startupResult = await runGoogleBookmarkScenario({
      serviceWorker,
      pageUrl: urls.startupGoogle,
      expectedBucket: "startupGoogleSearch",
      expectedTopHost: "bookmark-high.test",
    });

    const newTabResult = await runGoogleBookmarkScenario({
      serviceWorker,
      pageUrl: urls.newGoogle,
      expectedBucket: "newGoogleSearchTab",
      expectedTopHost: "bookmark-mid.test",
      createNewTab: true,
    });

    const nonGoogleResult = await runNonGoogleScenario({
      serviceWorker,
      pageUrl: urls.nonGoogle,
    });

    const trackingResult = await runSyntheticBookmarkTrackingChecks({
      serviceWorker,
      urls,
    });

    const result = {
      ok:
        settingsResult.ok &&
        startupResult.ok &&
        newTabResult.ok &&
        nonGoogleResult.ok &&
        trackingResult.ok,
      runDir,
      extensionId,
      settingsResult,
      startupResult,
      newTabResult,
      nonGoogleResult,
      trackingResult,
    };

    await writeFile(
      path.join(runDir, "result.json"),
      JSON.stringify(result, null, 2),
      "utf8"
    );
    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    for (const client of clients.reverse()) {
      client.close();
    }
    chrome.kill();
    server.close();
    await rm(extensionUnderTestDir, { recursive: true, force: true });
  }
}

function buildTestUrls(port) {
  return {
    startupGoogle: `http://www.google.com:${port}/search?q=startup-smoke`,
    newGoogle: `http://www.google.com:${port}/search?q=newtab-smoke`,
    nonGoogle: `http://nongoogle.test:${port}/plain`,
    bookmarkHigh: `http://bookmark-high.test:${port}/bookmark/high`,
    bookmarkMid: `http://bookmark-mid.test:${port}/bookmark/mid`,
    bookmarkLow: `http://bookmark-low.test:${port}/bookmark/low`,
    resultA: `http://page-result.test:${port}/result/a`,
    resultB: `http://page-result.test:${port}/result/b`,
  };
}

async function setupExtensionState(serviceWorker, urls) {
  await swEval(serviceWorker, async ({ urls }) => {
    if (!chrome.bookmarks?.create || !chrome.bookmarks?.getTree) {
      throw new Error(JSON.stringify({
        reason: "bookmarks-api-unavailable",
        manifest: chrome.runtime?.getManifest?.() || null,
        chromeNamespaces: Object.keys(chrome || {}).sort(),
      }));
    }

    await chrome.bookmarks.create({ title: "Smoke Bookmark High", url: urls.bookmarkHigh });
    await chrome.bookmarks.create({ title: "Smoke Bookmark Mid", url: urls.bookmarkMid });
    await chrome.bookmarks.create({ title: "Smoke Bookmark Low", url: urls.bookmarkLow });

    const settings = globalThis.ZeroLatencySettings.cloneSettings(
      globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
    );
    settings.preloading.enabled = true;
    settings.preloading.aiPrediction.enabled = false;
    settings.preloadWindow.watchdogEnabled = true;
    settings.experiments.crossSiteCurrentTabSwap = true;
    settings.layout.ruleCards.items.googleBookmarkRank.status = "enabled";
    settings.layout.ruleCards.items.googleBookmarkRank.valueA = 1;
    settings.layout.ruleCards.items.googleBookmarkRank.operatorA = "lte";
    settings.layout.ruleCards.items.googleBookmarkRank.operatorB = "lte";
    settings.layout.ruleCards.items.googleBookmarkRank.valueC = 2;
    settings.layout.ruleCards.items.perPagePreloadLimit.valueC = 3;
    settings.layout.ruleCards.items.highWeightRankTab.valueC = 3;

    const storedSettings = await globalThis.ZeroLatencySettings.saveSettings(
      chrome.storage.local,
      settings
    );
    globalThis.backgroundState.setCachedSettings(storedSettings);

    const trackingState = await loadTrackingState();
    trackingState.graph.bookmarkPreloadBuckets.startupGoogleSearch = {
      [normalizePageUrlForIndex(urls.bookmarkHigh)]: 12,
      [normalizePageUrlForIndex(urls.bookmarkMid)]: 4,
      [normalizePageUrlForIndex(urls.bookmarkLow)]: 1,
    };
    trackingState.graph.bookmarkPreloadBuckets.newGoogleSearchTab = {
      [normalizePageUrlForIndex(urls.bookmarkHigh)]: 1,
      [normalizePageUrlForIndex(urls.bookmarkMid)]: 15,
      [normalizePageUrlForIndex(urls.bookmarkLow)]: 8,
    };
    trackingState.graph.updatedAt = new Date().toISOString();
    await saveTrackingState(trackingState);

    await globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();
    return {
      bookmarkCount: (await chrome.bookmarks.search({})).length,
      settings,
    };
  }, { urls });
}

async function waitForEffectiveTestSettings(serviceWorker, timeoutMs = 8000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await swEval(serviceWorker, async () => {
      const settings = getEffectiveExtensionSettings();
      return {
        googleBookmarkRank: settings?.layout?.ruleCards?.items?.googleBookmarkRank ?? null,
        preloadingEnabled: settings?.preloading?.enabled === true,
        crossSiteCurrentTabSwap: settings?.experiments?.crossSiteCurrentTabSwap === true,
      };
    });

    if (
      lastState?.preloadingEnabled === true &&
      lastState?.crossSiteCurrentTabSwap === true &&
      lastState?.googleBookmarkRank?.status === "enabled" &&
      Number(lastState?.googleBookmarkRank?.valueC) === 2
    ) {
      return lastState;
    }

    await sleep(150);
  }

  throw new Error(
    `Timed out waiting for test settings to become effective: ${JSON.stringify(lastState)}`
  );
}

async function inspectSettingsPage({ debugPort, serviceWorker, extensionId, clients }) {
  const settingsUrl = `chrome-extension://${extensionId}/settings/index.html`;
  await swEval(serviceWorker, async ({ settingsUrl }) => {
    await chrome.tabs.create({ url: settingsUrl, active: true });
    return true;
  }, { settingsUrl });

  const settingsTarget = await waitForTarget(debugPort, (target) =>
    target.type === "page" && target.url === settingsUrl
  );
  const page = await CdpClient.connect(settingsTarget.webSocketDebuggerUrl);
  clients.push(page);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await waitForPageReady(page);

  const dom = await pageEval(page, () => {
    const cardIds = (selector) =>
      Array.from(document.querySelector(selector)?.children || [])
        .filter((element) => element.matches?.("[data-card-id]"))
        .map((element) => element.dataset.cardId);

    return {
      title: document.title,
      preloadCards: cardIds("#preload-rule-cards-list"),
      rankingCards: cardIds("#ranking-rule-cards-list"),
      hasSortableList: Boolean(document.getElementById("sortable-cards-list")),
      draggableElementCount: document.querySelectorAll("[draggable='true']").length,
      hasWeightRangeCard: Boolean(document.querySelector("[data-card-id='weightRange']")),
      orderingText: document.getElementById("ordering")?.innerText || "",
    };
  });

  const screenshot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  const screenshotPath = path.join(runDir, "settings-page.png");
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  const ok =
    dom.preloadCards.join(",") === "nativePerPagePreloadLimit,perPagePreloadLimit" &&
    dom.rankingCards.join(",") === "highWeightRank,highWeightRankTab,googleBookmarkRank" &&
    dom.hasSortableList === false &&
    dom.draggableElementCount === 0 &&
    dom.hasWeightRangeCard === false;

  return {
    ok,
    screenshotPath,
    dom,
  };
}

async function runGoogleBookmarkScenario({
  serviceWorker,
  pageUrl,
  expectedBucket,
  expectedTopHost,
  createNewTab = false,
}) {
  const state = await swEval(serviceWorker, async ({ pageUrl, createNewTab }) => {
    if (createNewTab) {
      const createdTab = await chrome.tabs.create({ url: pageUrl, active: true });
      await chrome.windows.update(createdTab.windowId, { focused: true });
      return { tabId: createdTab.id, windowId: createdTab.windowId };
    }

    const tabs = await chrome.tabs.query({});
    const targetTab =
      tabs.find((tab) => /^http:\/\/www\.google\.com:\d+\/search/.test(tab.url || "")) ||
      tabs.find((tab) => tab.active) ||
      tabs[0];
    await chrome.tabs.update(targetTab.id, { url: pageUrl, active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    return { tabId: targetTab.id, windowId: targetTab.windowId };
  }, { pageUrl, createNewTab });

  await waitForTabComplete(serviceWorker, state.tabId);
  await requestCandidateRefresh(serviceWorker, state.tabId);
  const predictionProbe = await probeBookmarkPrediction(serviceWorker, state.tabId);

  const snapshot = await waitForSnapshotCondition(serviceWorker, state.tabId, (snapshot) =>
    (snapshot.currentTopTargets || []).some((target) => target.bookmarkPreload)
  );
  const runtime = await getRuntimeOccupancy(serviceWorker, state.tabId);
  const bookmarkTargets = (snapshot.currentTopTargets || []).filter(
    (target) => target.bookmarkPreload
  );
  const topBookmark = bookmarkTargets[0] || null;
  const topUrl = topBookmark?.requestedUrl || "";

  return {
    ok:
      Boolean(topBookmark) &&
      topBookmark.bookmarkPreload.bucketKey === expectedBucket &&
      topUrl.includes(expectedTopHost) &&
      runtime.nonSentinelPreloadTabCount <= 3 &&
      runtime.hiddenEntryCount <= 3 &&
      runtime.sentinelCount >= 1,
    expectedBucket,
    expectedTopHost,
    topBookmark,
    currentTopTargets: snapshot.currentTopTargets,
    bookmarkBuckets: snapshot.summary?.bookmarkPreloadBuckets,
    predictionProbe,
    recentRuntimeEvents: snapshot.recentRuntimeEvents,
    runtime,
  };
}

async function runNonGoogleScenario({ serviceWorker, pageUrl }) {
  const state = await swEval(serviceWorker, async ({ pageUrl }) => {
    const createdTab = await chrome.tabs.create({ url: pageUrl, active: true });
    await chrome.windows.update(createdTab.windowId, { focused: true });
    return { tabId: createdTab.id, windowId: createdTab.windowId };
  }, { pageUrl });

  await waitForTabComplete(serviceWorker, state.tabId);
  await requestCandidateRefresh(serviceWorker, state.tabId);
  await sleep(1500);

  const snapshot = await getDebugSnapshot(serviceWorker, state.tabId);
  const bookmarkTargets = (snapshot.currentTopTargets || []).filter(
    (target) => target.bookmarkPreload
  );

  return {
    ok: bookmarkTargets.length === 0,
    bookmarkTargets,
    currentTopTargets: snapshot.currentTopTargets,
    recentRuntimeEvents: snapshot.recentRuntimeEvents,
  };
}

async function probeBookmarkPrediction(serviceWorker, tabId) {
  return swEval(serviceWorker, async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    const sourceUrl = tab.url || "";
    const settings = getEffectiveExtensionSettings();
    const trackingState = await loadTrackingState();
    const sourceTabId = String(tab.id);
    const sourceWindowId = tab.windowId;
    const sourceNodeId = buildNodeSeed(sourceUrl).nodeId;
    const ruleState = settings?.layout?.ruleCards?.items?.googleBookmarkRank ?? null;
    const bookmarkApiAvailable =
      globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("bookmarks", "getTree") === true;
    let bookmarkTreeCount = null;
    let directBookmarkCandidates = null;
    let directSelection = null;
    let error = null;

    try {
      if (bookmarkApiAvailable) {
        bookmarkTreeCount = (await chrome.bookmarks.search({})).length;
      }

      directBookmarkCandidates = await buildGoogleBookmarkPreloadCandidateEntries({
        sourceNodeId,
        sourceUrl,
        sourceWindowId,
        sourceTabId,
        graph: trackingState.graph,
        settings,
        transitionWindowKey: getPreloadTransitionWindowKey(settings),
        linkIndexOffset: 0,
      });

      directSelection = await globalThis.ZeroLatencyPreloadPrediction.selectPreloadTargets({
        currentNodeId: sourceNodeId,
        sourceUrl,
        sourceWindowId,
        sourceTabId,
        currentPageTitle: tab.title || "",
        currentPageTextDigest: "",
        currentPageContentFingerprint: "",
        candidateLinks: [],
        graph: trackingState.graph,
        settings,
      });
    } catch (probeError) {
      error = probeError instanceof Error ? probeError.stack || probeError.message : String(probeError);
    }

    return {
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        active: tab.active,
        url: sourceUrl,
        status: tab.status,
      },
      serviceState: await loadServiceState(),
      bookmarkApiAvailable,
      bookmarkTreeCount,
      isGoogleBookmarkPage:
        typeof isGoogleSearchPageForBookmarkPreload === "function"
          ? isGoogleSearchPageForBookmarkPreload(sourceUrl)
          : null,
      ruleState,
      ruleEnabled: settingsApi.isRuleCardEnabled(ruleState),
      directBookmarkCandidates,
      directSelection,
      error,
      recentRuntimeEvents: globalThis.ZeroLatencyDebugEvents?.snapshot?.(80) ?? [],
      diagnostics: globalThis.ZeroLatencyDiagnostics?.getStatus?.() ?? null,
    };
  }, { tabId });
}

async function runSyntheticBookmarkTrackingChecks({ serviceWorker, urls }) {
  return swEval(serviceWorker, async ({ urls }) => {
    const normalizeBuckets = (buckets) => JSON.parse(JSON.stringify(buckets || {}));
    const tabs = await chrome.tabs.query({});
    const startupTab =
      tabs.find((item) => (item.url || "").startsWith(urls.startupGoogle)) ||
      tabs.find((item) => isGoogleSearchPageForBookmarkPreload(item.url || "")) ||
      tabs[0];
    const newGoogleTab =
      tabs.find((item) => (item.url || "").startsWith(urls.newGoogle)) ||
      tabs.find((item) => item.id !== startupTab?.id && isGoogleSearchPageForBookmarkPreload(item.url || "")) ||
      startupTab;
    const nonGoogleTab =
      tabs.find((item) => (item.url || "").startsWith(urls.nonGoogle)) ||
      tabs.find((item) => item.id !== startupTab?.id && item.id !== newGoogleTab?.id) ||
      startupTab;
    const before = normalizeBuckets((await loadTrackingState()).graph.bookmarkPreloadBuckets);

    const serviceState = await loadServiceState();
    serviceState.bookmarkPreloading = {
      startupGoogleSearchTabId: startupTab?.id ?? null,
      startupGoogleSearchWindowId: startupTab?.windowId ?? null,
    };
    serviceState.updatedAt = new Date().toISOString();
    await saveServiceState(serviceState);

    async function setSource(tabId, sourceUrl) {
      const state = await loadTrackingState();
      const nextState = await applyTrackingEvent(state, {
        type: "set-current-page",
        tabId: String(tabId),
        targetNode: buildNodeSeed(sourceUrl),
        occurredAt: new Date().toISOString(),
        url: normalizePageUrlForIndex(sourceUrl),
      });
      await saveTrackingState(nextState);
    }

    async function syntheticAutoBookmark(tab, sourceUrl, targetUrl) {
      await setSource(tab.id, sourceUrl);
      await recordVisit(
        {
          tabId: Number(tab.id),
          frameId: 0,
          url: targetUrl,
          transitionType: "auto_bookmark",
          timeStamp: Date.now(),
        },
        "codex-synthetic-auto-bookmark"
      );
      return normalizeBuckets((await loadTrackingState()).graph.bookmarkPreloadBuckets);
    }

    const startupAfter = await syntheticAutoBookmark(
      startupTab,
      urls.startupGoogle,
      urls.bookmarkHigh
    );
    const newAfter = await syntheticAutoBookmark(
      newGoogleTab,
      urls.newGoogle,
      urls.bookmarkMid
    );
    const nonGoogleAfter = await syntheticAutoBookmark(
      nonGoogleTab,
      urls.nonGoogle,
      urls.bookmarkLow
    );

    const highKey = normalizePageUrlForIndex(urls.bookmarkHigh);
    const midKey = normalizePageUrlForIndex(urls.bookmarkMid);
    const lowKey = normalizePageUrlForIndex(urls.bookmarkLow);
    const startupIncremented =
      (startupAfter.startupGoogleSearch?.[highKey] || 0) ===
      (before.startupGoogleSearch?.[highKey] || 0) + 1;
    const newIncremented =
      (newAfter.newGoogleSearchTab?.[midKey] || 0) ===
      (startupAfter.newGoogleSearchTab?.[midKey] || 0) + 1;
    const nonGoogleDidNotIncrement =
      (nonGoogleAfter.startupGoogleSearch?.[lowKey] || 0) ===
        (newAfter.startupGoogleSearch?.[lowKey] || 0) &&
      (nonGoogleAfter.newGoogleSearchTab?.[lowKey] || 0) ===
        (newAfter.newGoogleSearchTab?.[lowKey] || 0);

    return {
      ok: startupIncremented && newIncremented && nonGoogleDidNotIncrement,
      startupIncremented,
      newIncremented,
      nonGoogleDidNotIncrement,
      tabs: {
        startupTab: startupTab
          ? { id: startupTab.id, windowId: startupTab.windowId, url: startupTab.url }
          : null,
        newGoogleTab: newGoogleTab
          ? { id: newGoogleTab.id, windowId: newGoogleTab.windowId, url: newGoogleTab.url }
          : null,
        nonGoogleTab: nonGoogleTab
          ? { id: nonGoogleTab.id, windowId: nonGoogleTab.windowId, url: nonGoogleTab.url }
          : null,
      },
      before,
      startupAfter,
      newAfter,
      nonGoogleAfter,
    };
  }, { urls });
}

async function requestCandidateRefresh(serviceWorker, tabId) {
  await swEval(serviceWorker, async ({ tabId }) => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "preload:collect-candidates" });
    } catch (_error) {
      // A just-created tab can race content-script injection. Runtime refresh below covers it.
    }
    await requestPreloadCandidateRefreshForOpenTabs();
    return true;
  }, { tabId });
}

async function getDebugSnapshot(serviceWorker, tabId) {
  return swEval(serviceWorker, async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId);
    return globalThis.ZeroLatencyCoreMessages.handleDebugSnapshot({
      tabId,
      pageUrl: tab.url,
    });
  }, { tabId });
}

async function getRuntimeOccupancy(serviceWorker, tabId) {
  return swEval(serviceWorker, async ({ tabId }) => {
    const preloadState = await loadPreloadState();
    const runtimeEntry = findSourceTabRuntime(preloadState, tabId);
    const sourceTabRuntime = runtimeEntry?.sourceTabRuntime || null;
    const preloadWindowId = runtimeEntry?.normalWindowRuntime?.preloadWindow?.windowId || null;
    const preloadTabs = preloadWindowId
      ? await chrome.tabs.query({ windowId: preloadWindowId })
      : [];
    const sentinelUrl = PRELOAD_WINDOW_SENTINEL_URL;
    return {
      preloadWindowId,
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

async function waitForSnapshotCondition(serviceWorker, tabId, predicate, timeoutMs = 12000) {
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

async function waitForTabComplete(serviceWorker, tabId, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await swEval(serviceWorker, async ({ tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      return { status: tab.status, url: tab.url };
    }, { tabId });
    if (status.status === "complete") {
      await sleep(700);
      return status;
    }
    await sleep(300);
  }

  throw new Error(`Timed out waiting for tab ${tabId} to complete`);
}

async function waitForPageReady(page, timeoutMs = 10000) {
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

async function swEval(client, fn, arg = {}) {
  return runtimeEval(client, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function pageEval(client, fn, arg = {}) {
  return runtimeEval(client, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

async function runtimeEval(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "CDP Runtime.evaluate failed"
    );
  }
  return response.result?.value;
}

async function waitForTarget(debugPort, predicate, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastTargets = [];
  while (Date.now() - startedAt < timeoutMs) {
    let targets = [];
    try {
      targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      lastTargets = targets;
    } catch (_error) {
      await sleep(250);
      continue;
    }
    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) {
      return target;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for CDP target. Last targets: ${JSON.stringify(
      lastTargets.map((target) => ({
        type: target.type,
        url: target.url,
        title: target.title,
      })),
      null,
      2
    )}`
  );
}

async function waitForExtensionServiceWorker(debugPort, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastTargets = [];
  const inspectionErrors = [];

  while (Date.now() - startedAt < timeoutMs) {
    let targets = [];
    try {
      targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      lastTargets = targets;
    } catch (_error) {
      await sleep(250);
      continue;
    }

    for (const target of targets) {
      if (
        target.type !== "service_worker" ||
        !/^chrome-extension:\/\//.test(target.url || "") ||
        !target.webSocketDebuggerUrl
      ) {
        continue;
      }

      const client = await CdpClient.connect(target.webSocketDebuggerUrl);
      await client.send("Runtime.enable");

      try {
        const manifest = await runtimeEval(client, "chrome.runtime.getManifest()");
        const permissions = Array.isArray(manifest?.permissions)
          ? manifest.permissions
          : [];
        const manifestName = manifest?.name || "";
        const isTargetExtension =
          (manifestName === "__MSG_appName__" || manifestName === "Zero-Latency Web") &&
          permissions.includes("bookmarks") &&
          permissions.includes("storage");

        if (isTargetExtension) {
          return {
            ...target,
            manifest,
            client,
          };
        }
      } catch (error) {
        inspectionErrors.push({
          url: target.url,
          error: error?.message || String(error),
        });
        // Ignore unrelated component extensions.
      }

      client.close();
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for Zero-Latency Web service worker. Last targets: ${JSON.stringify(
      lastTargets.map((target) => ({
        type: target.type,
        url: target.url,
        title: target.title,
      })),
      null,
      2
    )}; inspection errors: ${JSON.stringify(inspectionErrors.slice(-8), null, 2)}`
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

class CdpClient {
  static async connect(webSocketUrl) {
    const client = new CdpClient(webSocketUrl);
    await client.open();
    return client;
  }

  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.webSocketUrl);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("WebSocket error")));
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
      this.ws.addEventListener("close", () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("CDP socket closed"));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 15000).unref?.();
    });
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (!message.id || !this.pending.has(message.id)) {
      return;
    }
    const pending = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
      return;
    }
    pending.resolve(message.result || {});
  }

  close() {
    try {
      this.ws?.close();
    } catch (_error) {
      // Ignore cleanup errors.
    }
  }
}

function launchChrome({ webPort, debugPort }) {
  const chromePath = chromePathCandidates.find((candidate) => candidate && existsSync(candidate));
  if (!chromePath) {
    throw new Error("Chrome executable was not found.");
  }

  const resolverRules = TEST_HOSTS
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(", ");
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    `--disable-extensions-except=${extensionUnderTestDir}`,
    `--load-extension=${extensionUnderTestDir}`,
    "--enable-unsafe-extension-debugging",
    `--host-resolver-rules=${resolverRules}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-features=Translate,AutofillServerCommunication",
    "--window-size=1280,900",
    `http://www.google.com:${webPort}/search?q=startup-smoke`,
  ];

  const child = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function prepareExtensionUnderTest() {
  await rm(extensionUnderTestDir, { recursive: true, force: true });
  await mkdir(extensionUnderTestDir, { recursive: true });

  const entries = [
    "manifest.json",
    "service-worker.js",
    "_locales",
    "background",
    "popup",
    "scripts",
    "settings",
    "shared",
    path.join("wasm", "pkg"),
  ];

  for (const entry of entries) {
    const source = path.join(extensionDir, entry);
    const target = path.join(extensionUnderTestDir, entry);
    if (!existsSync(source)) {
      continue;
    }
    await cp(source, target, {
      recursive: true,
      force: true,
    });
  }
}

async function startTestServer(port) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    const host = (request.headers.host || "").split(":")[0];
    response.setHeader("Cache-Control", "no-store");

    if (host === "www.google.com" && requestUrl.pathname === "/search") {
      respondHtml(response, renderGoogleSearchPage(requestUrl));
      return;
    }

    if (host === "nongoogle.test" && requestUrl.pathname === "/plain") {
      respondHtml(response, renderNonGooglePage(port));
      return;
    }

    respondHtml(response, renderTargetPage(host, requestUrl.pathname));
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function renderGoogleSearchPage(requestUrl) {
  const query = requestUrl.searchParams.get("q") || "";
  return `<!doctype html>
<html>
  <head><title>Google smoke ${escapeHtml(query)}</title></head>
  <body>
    <main>
      <h1>Google smoke ${escapeHtml(query)}</h1>
      <a href="/search?udm=50&q=${encodeURIComponent(query)}">AI mode should not be preferred</a>
      <a href="http://page-result.test:${requestUrl.port}/result/a">Result A</a>
      <a href="http://page-result.test:${requestUrl.port}/result/b" target="_blank">Result B blank</a>
      <a href="http://bookmark-low.test:${requestUrl.port}/bookmark/low">Visible low bookmark page</a>
    </main>
  </body>
</html>`;
}

function renderNonGooglePage(port) {
  return `<!doctype html>
<html>
  <head><title>Non Google smoke</title></head>
  <body>
    <h1>Non Google smoke</h1>
    <a href="http://bookmark-high.test:${port}/bookmark/high">Bookmark-looking link outside Google</a>
    <a href="http://page-result.test:${port}/result/a">Normal result</a>
  </body>
</html>`;
}

function renderTargetPage(host, pathname) {
  return `<!doctype html>
<html>
  <head><title>${escapeHtml(host)} ${escapeHtml(pathname)}</title></head>
  <body>
    <h1>${escapeHtml(host)}</h1>
    <p>Target page ${escapeHtml(pathname)}</p>
  </body>
</html>`;
}

function respondHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
