import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, pageEval, swEval } from "./lib/cdp-client.mjs";
import { waitForTarget } from "./lib/cdp-discovery.mjs";
import {
  launchBookmarkSmokeChrome,
  prepareBookmarkExtensionUnderTest,
  waitForBookmarkExtensionServiceWorker,
} from "./lib/bookmark-preload-smoke-browser.mjs";
import {
  buildBookmarkSmokeUrls,
  startBookmarkSmokeServer,
} from "./lib/bookmark-preload-smoke-site.mjs";
import {
  getDebugSnapshot,
  getRuntimeOccupancy,
  requestCandidateRefresh,
  waitForPageReady,
  waitForRuntimeCondition,
  waitForSnapshotCondition,
  waitForTabComplete,
} from "./lib/bookmark-preload-smoke-probes.mjs";
import { getPlaywrightChromiumPathCandidates } from "./lib/browser-paths.mjs";
import { getFreePort, sleep } from "./lib/test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extension");
const outputRoot = path.join(repoRoot, "output", "playwright");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(outputRoot, `bookmark-preload-smoke-${runId}`);
const profileDir = path.join(runDir, "chromium-profile");
const extensionUnderTestDir = path.join(os.tmpdir(), `zlw-ext-smoke-${process.pid}-${Date.now()}`);

const chromiumPathCandidates = getPlaywrightChromiumPathCandidates();

async function main() {
  await mkdir(runDir, { recursive: true });
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  await prepareExtensionUnderTest();

  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  const server = await startBookmarkSmokeServer(webPort);
  const chrome = launchBookmarkSmokeChrome({
    browserPathCandidates: chromiumPathCandidates,
    debugPort,
    extensionUnderTestDir,
    profileDir,
    webPort,
  });
  const clients = [];

  try {
    const serviceWorkerTarget = await waitForBookmarkExtensionServiceWorker(debugPort);
    const extensionId = new URL(serviceWorkerTarget.url).host;
    const serviceWorker = serviceWorkerTarget.client;
    clients.push(serviceWorker);

    console.log("[bookmark-smoke] inspect settings page");
    const settingsResult = await inspectSettingsPage({
      debugPort,
      serviceWorker,
      extensionId,
      clients,
    });

    console.log("[bookmark-smoke] setup extension state");
    const urls = buildBookmarkSmokeUrls(webPort);
    await setupExtensionState(serviceWorker, urls);
    await waitForEffectiveTestSettings(serviceWorker);

    console.log("[bookmark-smoke] startup google scenario");
    const startupResult = await runGoogleBookmarkScenario({
      serviceWorker,
      pageUrl: urls.startupGoogle,
      expectedBucket: "startupGoogleSearch",
      expectedTopHost: "bookmark-high.test",
    });

    console.log("[bookmark-smoke] new google tab scenario");
    const newTabResult = await runGoogleBookmarkScenario({
      serviceWorker,
      pageUrl: urls.newGoogle,
      expectedBucket: "newGoogleSearchTab",
      expectedTopHost: "bookmark-mid.test",
      createNewTab: true,
      requireRuntimeBookmark: false,
    });

    console.log("[bookmark-smoke] non-google scenario");
    const nonGoogleResult = await runNonGoogleScenario({
      serviceWorker,
      pageUrl: urls.nonGoogle,
    });

    console.log("[bookmark-smoke] synthetic tracking checks");
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

// 设置写入必须包在 queueMutation 内并验证生效，否则可能与 service worker 的 bootstrap
// 并发：bootstrap 会用它更早读到的 cachedUserSettings 整体写回 SETTINGS_STORAGE_KEY
// （bootstrap.js:66-75），把这里刚写的 realPreloadEnabled=true 覆盖回默认 false，
// 整场 smoke 就一个真实预加载都不会发生。这与 click-intercept-navigation-smoke 曾经的
// 空跑是同一个根因，也是 lib/preload-extension-helpers.mjs 的
// configureRealPreloadTestState 一直重试到确认生效的原因。
//
// 这里没有直接复用那个 helper，因为本 smoke 还要种 bookmark buckets 和书签专属规则卡，
// 不在它的参数范围内；改为套用同一套做法。
// 验证必须同时覆盖**设置**和**种进 graph 的 bookmark buckets**：bootstrap 的整体写回
// 里既有 SETTINGS_STORAGE_KEY 也有 GRAPH_KEY（bootstrap.js:67-68），只验证设置的话，
// 种子被 bootstrap 用陈旧 graph 覆盖掉仍然发现不了 —— 表现就是排名断言
// expectedTopHost 失败，因为排名依据的桶数据没了。
async function setupExtensionState(serviceWorker, urls) {
  let lastApplied = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await writeBookmarkSmokeState(serviceWorker, urls);
    lastApplied = await swEval(
      serviceWorker,
      async ({ urls }) => {
        const effective = getEffectiveExtensionSettings();
        const trackingState = await loadTrackingState();
        const startupBucket =
          trackingState?.graph?.bookmarkPreloadBuckets?.startupGoogleSearch || {};
        const newTabBucket =
          trackingState?.graph?.bookmarkPreloadBuckets?.newGoogleSearchTab || {};
        return {
          preloadingEnabled: effective?.preloading?.enabled === true,
          realPreloadEnabled: effective?.preloading?.realPreloadEnabled === true,
          startupHighCount: startupBucket[normalizePageUrlForIndex(urls.bookmarkHigh)] ?? null,
          newTabMidCount: newTabBucket[normalizePageUrlForIndex(urls.bookmarkMid)] ?? null,
        };
      },
      { urls }
    );

    if (
      lastApplied.preloadingEnabled &&
      lastApplied.realPreloadEnabled &&
      lastApplied.startupHighCount === 12 &&
      lastApplied.newTabMidCount === 15
    ) {
      return result;
    }
  }

  throw new Error(
    `Failed to apply bookmark smoke state after 5 attempts: ${JSON.stringify(lastApplied)}`
  );
}

async function writeBookmarkSmokeState(serviceWorker, urls) {
  return swEval(serviceWorker, async ({ urls }) => {
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

    // 从这里到 saveTrackingState 整段进 mutation lane，避免与 bootstrap 的整体写回交错。
    const appliedSettings = await queueMutation(async () => {
      const settings = globalThis.ZeroLatencySettings.cloneSettings(
      globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
    );
    settings.preloading.enabled = true;
    settings.preloading.realPreloadEnabled = true;
    settings.preloading.aiPrediction.enabled = false;
    settings.tracking.excludeHttpPages = false;
    settings.tracking.excludeLocalPages = false;
    settings.tracking.excludePrivateNetworkPages = false;
    settings.preloadWindow.watchdogEnabled = false;
    settings.preloadWindow.fullscreenPressurePolicy = "ignore";
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
      return settings;
    });

    return {
      bookmarkCount: (await chrome.bookmarks.search({})).length,
      settings: appliedSettings,
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

  // waitForPageReady 只保证文档就绪，规则卡是设置页读完存储后**异步渲染**的。
  // 之前直接在这里取快照，渲染慢一点就会拿到 preloadCards: []，断言随即失败——
  // 这正是本 smoke 间歇性失败的原因，与书签排名无关（排名场景一直是通过的）。
  await waitForSettingsRuleCards(page);

  const dom = await pageEval(page, () => {
    const cardIds = (selector) =>
      Array.from(document.querySelector(selector)?.children || [])
        .filter((element) => element.matches?.("[data-card-id]"))
        .map((element) => element.dataset.cardId);

    return {
      title: document.title,
      preloadCards: cardIds("#preload-rule-cards-list"),
      trackingCards: cardIds("#tracking-rule-cards-list"),
      hasSortableList: Boolean(document.getElementById("sortable-cards-list")),
      draggableElementCount: document.querySelectorAll("[draggable='true']").length,
      hasWeightRangeCard: Boolean(document.querySelector("[data-card-id='weightRange']")),
      hasOverviewSection: Boolean(
        document.getElementById("overview") || document.getElementById("overview-panel")
      ),
      hasOverviewNav: Array.from(document.querySelectorAll(".settings-nav-title")).some((item) =>
        /Overview|概览/.test(item.textContent || "")
      ),
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
    dom.preloadCards.join(",") ===
      "nativePerPagePreloadLimit,highWeightRank,perPagePreloadLimit,highWeightRankTab,googleBookmarkRank" &&
    dom.trackingCards.join(",") === "" &&
    dom.hasOverviewSection === false &&
    dom.hasOverviewNav === false &&
    dom.hasSortableList === false &&
    dom.draggableElementCount === 0 &&
    dom.hasWeightRangeCard === false;

  return {
    ok,
    screenshotPath,
    dom,
  };
}

// 等设置页把预加载规则卡渲染出来。断言的是卡片顺序，所以必须等到列表非空且稳定，
// 否则拿到的是渲染中途的空列表。
async function waitForSettingsRuleCards(page, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastCount = -1;
  let stableRounds = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const count = await pageEval(page, () =>
      Array.from(document.querySelector("#preload-rule-cards-list")?.children || []).filter(
        (element) => element.matches?.("[data-card-id]")
      ).length
    );

    if (count > 0 && count === lastCount) {
      stableRounds += 1;

      // 连续两轮数量不变才认为渲染完成，避免抓到中途状态。
      if (stableRounds >= 2) {
        return count;
      }
    } else {
      stableRounds = 0;
    }

    lastCount = count;
    await sleep(150);
  }

  throw new Error(
    `Timed out waiting for settings rule cards to render (last count: ${lastCount}).`
  );
}

async function runGoogleBookmarkScenario({
  serviceWorker,
  pageUrl,
  expectedBucket,
  expectedTopHost,
  createNewTab = false,
  requireRuntimeBookmark = true,
}) {
  console.log(`[bookmark-smoke] google scenario: open ${pageUrl}`);
  const state = await swEval(serviceWorker, async ({ pageUrl, createNewTab }) => {
    if (createNewTab) {
      const createdTab = await chrome.tabs.create({ url: pageUrl, active: true });
      await chrome.windows.update(createdTab.windowId, { focused: true });
      return { tabId: createdTab.id, windowId: createdTab.windowId };
    }

    const tabs = await chrome.tabs.query({});
    const targetTab =
      tabs.find((tab) => /^http:\/\/www\.google\.test:\d+\/search/.test(tab.url || "")) ||
      tabs.find((tab) => /^https?:\/\//.test(tab.url || ""));
    if (!targetTab) {
      const createdTab = await chrome.tabs.create({ url: pageUrl, active: true });
      await chrome.windows.update(createdTab.windowId, { focused: true });
      return { tabId: createdTab.id, windowId: createdTab.windowId };
    }
    const usableTab = targetTab;
    await chrome.tabs.update(usableTab.id, { url: pageUrl, active: true });
    await chrome.windows.update(usableTab.windowId, { focused: true });
    return { tabId: usableTab.id, windowId: usableTab.windowId };
  }, { pageUrl, createNewTab });

  console.log(`[bookmark-smoke] google scenario: wait complete tab ${state.tabId}`);
  await waitForTabComplete(serviceWorker, state.tabId);
  console.log(`[bookmark-smoke] google scenario: request refresh tab ${state.tabId}`);
  await requestCandidateRefresh(serviceWorker, state.tabId);
  console.log(`[bookmark-smoke] google scenario: wait prediction probe tab ${state.tabId}`);
  const predictionProbe = await waitForBookmarkPredictionProbe(
    serviceWorker,
    state.tabId,
    expectedBucket,
    expectedTopHost
  );

  console.log(`[bookmark-smoke] google scenario: wait snapshot tab ${state.tabId}`);
  const snapshot = await waitForSnapshotCondition(serviceWorker, state.tabId, (nextSnapshot) =>
    Array.isArray(nextSnapshot?.currentTopTargets)
  );
  console.log(`[bookmark-smoke] google scenario: wait runtime tab ${state.tabId}`);
  const runtime = requireRuntimeBookmark
    ? await waitForRuntimeCondition(serviceWorker, state.tabId, (nextRuntime) =>
        (nextRuntime.hiddenEntries || []).some(
          (entry) =>
            entry.bookmarkPreload?.bucketKey === expectedBucket &&
            entry.requestedUrl.includes(expectedTopHost)
        )
      )
    : await getRuntimeOccupancy(serviceWorker, state.tabId);
  const bookmarkTargets = (predictionProbe.directSelection?.tabTargets || []).filter(
    (target) => target.bookmarkPreload
  );
  const topBookmark = bookmarkTargets[0] || null;
  const topUrl = topBookmark?.url || topBookmark?.requestedUrl || "";
  const runtimeHasExpectedBookmark = (runtime.hiddenEntries || []).some(
    (entry) =>
      entry.bookmarkPreload?.bucketKey === expectedBucket &&
      entry.requestedUrl.includes(expectedTopHost)
  );
  const bookmarkTargetsAreIndependent = bookmarkTargets.every(
    (target) =>
      Number(target.score) === 0 &&
      target.scoreBreakdown === null &&
      target.siteSelection === null
  );

  return {
    ok:
      Boolean(topBookmark) &&
      topBookmark.bookmarkPreload.bucketKey === expectedBucket &&
      topUrl.includes(expectedTopHost) &&
      bookmarkTargetsAreIndependent &&
      (!requireRuntimeBookmark ||
        (runtimeHasExpectedBookmark &&
          runtime.nonSentinelPreloadTabCount >= bookmarkTargets.length &&
          runtime.hiddenEntryCount >= bookmarkTargets.length &&
          runtime.sentinelCount >= 1)),
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
    let directBookmarkTargets = null;
    let directSelection = null;
    let error = null;

    try {
      if (bookmarkApiAvailable) {
        bookmarkTreeCount = (await chrome.bookmarks.search({})).length;
      }

      directBookmarkTargets = await buildGoogleBookmarkPreloadTargets({
        sourceUrl,
        sourceWindowId,
        sourceTabId,
        graph: trackingState.graph,
        settings,
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
      directBookmarkTargets,
      directSelection,
      error,
      recentRuntimeEvents: globalThis.ZeroLatencyDebugEvents?.snapshot?.(80) ?? [],
      diagnostics: globalThis.ZeroLatencyDiagnostics?.getStatus?.() ?? null,
    };
  }, { tabId });
}

async function waitForBookmarkPredictionProbe(
  serviceWorker,
  tabId,
  expectedBucket,
  expectedTopHost,
  timeoutMs = 12000
) {
  const startedAt = Date.now();
  let lastProbe = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastProbe = await probeBookmarkPrediction(serviceWorker, tabId);
    const bookmarkTargets = (lastProbe.directSelection?.tabTargets || []).filter(
      (target) => target.bookmarkPreload
    );
    const topBookmark = bookmarkTargets[0] || null;
    const topUrl = topBookmark?.url || topBookmark?.requestedUrl || "";

    if (
      lastProbe.ruleEnabled === true &&
      topBookmark?.bookmarkPreload?.bucketKey === expectedBucket &&
      topUrl.includes(expectedTopHost)
    ) {
      return lastProbe;
    }

    await requestCandidateRefresh(serviceWorker, tabId);
    await sleep(700);
  }

  return lastProbe;
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

async function prepareExtensionUnderTest() {
  await prepareBookmarkExtensionUnderTest({
    extensionDir,
    targetDir: extensionUnderTestDir,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
