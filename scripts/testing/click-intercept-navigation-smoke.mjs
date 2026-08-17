import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, swEval } from "./lib/cdp-client.mjs";
import { waitForTarget } from "./lib/cdp-discovery.mjs";
import {
  findFirstExistingExecutable,
  getSharedPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import {
  getEventName,
  getFreePort,
  rmWithRetry,
  sameUrl,
  sleep,
  stripHash,
} from "./lib/test-utils.mjs";
import {
  closeClickInterceptChrome,
  launchClickInterceptChrome,
  prepareClickInterceptExtension,
  startClickInterceptServer,
  waitForClickInterceptExtensionServiceWorker,
} from "./lib/click-intercept-smoke-support.mjs";
import {
  dispatchLeftClick,
  dispatchMouseMove,
  waitForLinkPoint,
} from "./lib/cdp-input-helpers.mjs";
import { configureRealPreloadTestState } from "./lib/preload-extension-helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extension");

const runRoot = path.join(
  os.tmpdir(),
  `zlw-click-intercept-smoke-${process.pid}-${Date.now()}`
);
const profileDir = path.join(runRoot, "chromium-profile");
const extensionUnderTestDir = path.join(runRoot, "extension");

const chromiumPath = findFirstExistingExecutable(getSharedPlaywrightChromiumPathCandidates());

const CROSS_ORIGIN_SCENARIO_COUNT = 10;
const SAME_ORIGIN_SCENARIO_COUNT = 3;

// 跨源：扩展会 preventDefault 并接管，真实预加载激活走这条路。
const CROSS_ORIGIN_SCENARIOS = Array.from(
  { length: CROSS_ORIGIN_SCENARIO_COUNT },
  (_, index) => ({
    id: index + 1,
    sourceHost: `click-source-${index + 1}.test`,
    targetHost: `click-target-${index + 1}.test`,
    targetHint: "_self",
    sameOrigin: false,
  })
);

// 同源：后台的 tryActivateClickPreload 被 `!isSameOriginNavigation` 挡住，接管不可能
// 发生，所以扩展不应拦截，必须让浏览器原生导航。这是 SPA 内部链接的形状。
const SAME_ORIGIN_SCENARIOS = Array.from(
  { length: SAME_ORIGIN_SCENARIO_COUNT },
  (_, index) => {
    const id = CROSS_ORIGIN_SCENARIO_COUNT + index + 1;
    const host = `click-same-origin-${index + 1}.test`;
    return {
      id,
      sourceHost: host,
      targetHost: host,
      targetHint: "_self",
      sameOrigin: true,
    };
  }
);

const SCENARIOS = [...CROSS_ORIGIN_SCENARIOS, ...SAME_ORIGIN_SCENARIOS];

async function main() {
  console.error(`[click-smoke] run root: ${runRoot}`);
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  console.error("[click-smoke] preparing extension fixture");
  await prepareExtensionUnderTest();

  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  const scenarios = buildScenarioUrls(webPort);
  console.error(`[click-smoke] starting test server on ${webPort}`);
  const server = await startClickInterceptServer(webPort, scenarios);
  console.error(`[click-smoke] launching chromium on debug port ${debugPort}`);
  const chrome = launchClickInterceptChrome({
    chromiumPath,
    debugPort,
    extensionUnderTestDir,
    profileDir,
    scenarios,
  });
  const clients = [];

  try {
    console.error("[click-smoke] waiting for extension service worker");
    const serviceWorkerTarget = await waitForClickInterceptExtensionServiceWorker(debugPort);
    const serviceWorker = serviceWorkerTarget.client;
    clients.push(serviceWorker);

    console.error("[click-smoke] waiting for background ready");
    await waitForBackgroundReady(serviceWorker);
    console.error("[click-smoke] applying extension state");
    await setupExtensionState(serviceWorker);

    const results = [];

    for (const scenario of scenarios) {
      console.error(`[click-smoke] scenario ${scenario.id}/${scenarios.length}: start`);
      results.push(
        await runClickScenario({
          debugPort,
          serviceWorker,
          scenario,
          clients,
          pageClickObservations: server.pageClickObservations,
        })
      );
      console.error(`[click-smoke] scenario ${scenario.id}/${scenarios.length}: done`);
    }

    const failed = results.filter((result) => !result.ok);
    // 空跑保护：如果一次运行里**一个预加载都没就绪**，那么关于激活接管的部分什么都没
    // 验证——`ok` 却仍会是 true，因为逐场景断言只看导航是否到达、点击有没有被吞、页面
    // 处理器有没有跑。这类"绿"具有误导性，实测出现率不低（见
    // docs/internal/review-2026-07-31.md 的 flaky 记录），所以显式判为不通过。
    //
    // 注意这不是回归，而是**运行无效**：可能是环境竞态，也可能是真实退化，两者都需要
    // 人看一眼，不能当成通过。
    // 用「跨源场景是否产生过激活尝试」作为判据，比看预加载数更直接：它正是激活路径被
    // 走到的标志。同源场景本来就不该有激活尝试（那是本轮改动的目的），必须排除在外。
    const crossOriginResults = results.filter((result) => !result.sameOrigin);
    const exercisedActivation = crossOriginResults.filter(
      (result) => result.activationAttempt
    ).length;
    const vacuous = crossOriginResults.length > 0 && exercisedActivation === 0;
    const summary = {
      ok: failed.length === 0 && !vacuous,
      vacuous,
      vacuousReason: vacuous
        ? `${crossOriginResults.length} 个跨源场景无一产生激活尝试，激活路径未被验证；` +
          "重跑，若持续出现则排查环境或退化"
        : null,
      exercisedActivation,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      swallowedClicks: results.filter((result) => result.swallowed).length,
      pageClickHandlerMissed: results.filter((result) => !result.pageClickHandlerRan).length,
      unexpectedInterceptions: results.filter((result) => result.unexpectedInterception).length,
      preloadedBeforeClick: results.filter((result) => result.preloadedBeforeClick).length,
      activationAttempts: results.filter((result) => result.activationAttempt).length,
      activationHits: results.filter((result) => result.activationHit).length,
      scenarios: results,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    for (const client of clients.reverse()) {
      client.close();
    }
    await closeClickInterceptChrome({ chrome, debugPort });
    server.close();
    await rmWithRetry(runRoot);
  }
}

function buildScenarioUrls(port) {
  return SCENARIOS.map((scenario) => ({
    ...scenario,
    sourceUrl: `http://${scenario.sourceHost}:${port}/source/${scenario.id}`,
    targetUrl: `http://${scenario.targetHost}:${port}/target/${scenario.id}`,
  }));
}

async function runClickScenario({
  debugPort,
  serviceWorker,
  scenario,
  clients,
  pageClickObservations,
}) {
  console.error(`[click-smoke] ${scenario.id}: create source tab`);
  const source = await swEval(serviceWorker, async ({ sourceUrl }) => {
    const createdTab = await chrome.tabs.create({ url: sourceUrl, active: true });
    await chrome.windows.update(createdTab.windowId, { focused: true });
    return {
      tabId: createdTab.id,
      windowId: createdTab.windowId,
    };
  }, { sourceUrl: scenario.sourceUrl });

  await waitForTabComplete(serviceWorker, source.tabId);
  console.error(`[click-smoke] ${scenario.id}: source tab complete`);
  const pageTarget = await waitForTarget(
    debugPort,
    (target) => target.type === "page" && stripHash(target.url) === stripHash(scenario.sourceUrl)
  );
  const page = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  clients.push(page);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.bringToFront");
  const clickPoint = await waitForLinkPoint(page, "target-link");
  await dispatchMouseMove(page, clickPoint);
  await sleep(600);
  await dispatchMouseMove(page, {
    x: clickPoint.x + 1,
    y: clickPoint.y + 1,
  });
  await sleep(250);

  await requestCandidateRefresh(serviceWorker, source.tabId);
  console.error(`[click-smoke] ${scenario.id}: wait for preloaded target`);
  const preloadBeforeClick = await waitForPreloadedTarget(
    serviceWorker,
    source.tabId,
    scenario.targetUrl
  );
  console.error(
    `[click-smoke] ${scenario.id}: preload ready=${preloadBeforeClick.ready} status=${preloadBeforeClick.status}`
  );

  const beforeEventCount = await getDebugEventCount(serviceWorker);

  await dispatchLeftClick(page, clickPoint);
  console.error(`[click-smoke] ${scenario.id}: click dispatched`);

  const finalState = await waitForClickedTarget({
    serviceWorker,
    sourceWindowId: source.windowId,
    sourceTabId: source.tabId,
    targetUrl: scenario.targetUrl,
    targetHint: scenario.targetHint,
  });
  const relatedEvents = await getRelatedDebugEvents(serviceWorker, {
    targetUrl: scenario.targetUrl,
    afterIndex: beforeEventCount,
  });

  const activationAttempt = relatedEvents.some((event) =>
    includesEventName(event, "activation-attempt")
  );
  const activationHit = relatedEvents.some((event) =>
    includesEventName(event, "activation-hit") ||
    includesEventName(event, "preload-activation.success")
  );
  const activationMiss = relatedEvents.some((event) =>
    includesEventName(event, "activation-miss")
  );
  const finalReachedTarget = finalState.tabs.some((tab) =>
    sameUrl(tab.url, scenario.targetUrl) && tab.active === true
  );
  const swallowed = activationAttempt && !finalReachedTarget;
  // 页面自己注册在 anchor 上的监听器是否跑过。扩展在 document 捕获阶段
  // stopPropagation() 会让它收不到点击 —— 那正是打断 SPA 路由和点击统计的破坏，
  // 而单看“导航是否发生”是测不出来的。
  const pageClickHandlerRan = pageClickObservations.has(scenario.id);
  // 同源导航后台不可能激活预加载，扩展不该拦截。出现激活尝试即为回归。
  const unexpectedInterception = scenario.sameOrigin === true && activationAttempt === true;
  const ok =
    finalReachedTarget && !swallowed && pageClickHandlerRan && !unexpectedInterception;

  await cleanupScenarioTabs(serviceWorker, {
    sourceTabId: source.tabId,
    targetUrl: scenario.targetUrl,
  });
  console.error(
    `[click-smoke] ${scenario.id}: ok=${ok} swallowed=${swallowed} ` +
      `pageHandler=${pageClickHandlerRan} sameOrigin=${scenario.sameOrigin === true}`
  );

  return {
    id: scenario.id,
    targetHint: scenario.targetHint,
    sameOrigin: scenario.sameOrigin === true,
    sourceUrl: scenario.sourceUrl,
    targetUrl: scenario.targetUrl,
    ok,
    swallowed,
    pageClickHandlerRan,
    unexpectedInterception,
    preloadedBeforeClick: preloadBeforeClick.ready,
    preloadedStatus: preloadBeforeClick.status,
    activationAttempt,
    activationHit,
    activationMiss,
    finalReachedTarget,
    finalActiveUrl: finalState.activeTab?.url || null,
    eventNames: relatedEvents.map(getEventName).filter(Boolean),
  };
}

// 改用公共的 configureRealPreloadTestState，而不是自己写一遍设置写入。
//
// 原来这里是一次性 saveSettings + applyRuntimeSettingsAction，**不验证也不重试**。
// 问题在于它可能与 service worker 的 bootstrap 并发：bootstrap 会用它更早读到的
// cachedUserSettings 整体写回 SETTINGS_STORAGE_KEY（bootstrap.js:66-75），把测试刚写入的
// realPreloadEnabled=true 覆盖回默认的 false —— 于是整场 smoke 一个预加载都不会发生。
//
// 公共 helper 把写入包在 queueMutation 里，并最多重试 5 次直到读回来确认设置生效。
// context-menu-routing-smoke 和 preload-browser-isolation-smoke 一直用的就是它。
//
// 生产里的同一个竞态见审查报告 H18：设置页保存撞上 service worker 冷启动会被静默回退。
async function setupExtensionState(serviceWorker) {
  await configureRealPreloadTestState(serviceWorker, {
    diagnosticsEnabled: true,
    preloadWindowWatchdogEnabled: true,
    // 原 setupExtensionState 只设 tab 侧的 3 个槽位，这里保持一致。
    nativeTotalSlots: 3,
    tabTotalSlots: 3,
    nativePerPageSlots: 3,
    tabPerPageSlots: 3,
  });

  await swEval(serviceWorker, async () => {
    await globalThis.ZeroLatencyNativeAppHeartbeat?.ensureAlarm?.(false);
    await chrome.alarms.clear(globalThis.ZeroLatencyNativeAppHeartbeat?.wakeAlarmName);
    return true;
  });
}

async function waitForBackgroundReady(serviceWorker, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await swEval(serviceWorker, async () => ({
      hasSettings: typeof globalThis.ZeroLatencySettings?.cloneSettings === "function",
      hasRuntimeActions:
        typeof globalThis.ZeroLatencyRuntimeActions?.applyRuntimeSettingsAction === "function",
      hasBackgroundState: Boolean(globalThis.backgroundState),
    }));

    if (
      lastState.hasSettings &&
      lastState.hasRuntimeActions &&
      lastState.hasBackgroundState
    ) {
      return lastState;
    }

    await sleep(150);
  }

  throw new Error(`Timed out waiting for background readiness: ${JSON.stringify(lastState)}`);
}

async function requestCandidateRefresh(serviceWorker, tabId) {
  await swEval(serviceWorker, async ({ tabId }) => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "preload:collect-candidates" });
    } catch (_error) {
      // Runtime refresh below covers content-script injection races.
    }
    await requestPreloadCandidateRefreshForOpenTabs();
    return true;
  }, { tabId });
}

async function waitForPreloadedTarget(serviceWorker, sourceTabId, targetUrl, timeoutMs = 3000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getPreloadedTargetState(serviceWorker, sourceTabId, targetUrl);
    if (lastState.ready === true) {
      return lastState;
    }
    await requestCandidateRefresh(serviceWorker, sourceTabId);
    await sleep(700);
  }

  return lastState || { ready: false, status: null, tabUrl: null };
}

async function getPreloadedTargetState(serviceWorker, sourceTabId, targetUrl) {
  return swEval(serviceWorker, async ({ sourceTabId, targetUrl }) => {
    const preloadState = await loadPreloadState();
    const runtimeEntry = findSourceTabRuntime(preloadState, sourceTabId);
    const entry = runtimeEntry?.sourceTabRuntime?.hiddenTabEntriesByUrl?.[targetUrl] ?? null;
    const preloadedTab = entry?.tabId
      ? await chrome.tabs.get(entry.tabId).catch(() => null)
      : null;

    return {
      ready: Boolean(entry && preloadedTab),
      status: preloadedTab?.status || entry?.status || null,
      tabUrl: preloadedTab?.url || entry?.loadedUrl || null,
      tabId: preloadedTab?.id || entry?.tabId || null,
    };
  }, { sourceTabId, targetUrl });
}

async function waitForClickedTarget({
  serviceWorker,
  sourceWindowId,
  sourceTabId,
  targetUrl,
  targetHint,
  timeoutMs = 7000,
}) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await swEval(serviceWorker, async ({ sourceWindowId, sourceTabId }) => {
      const tabs = await chrome.tabs.query({ windowId: sourceWindowId });
      const activeTab = tabs.find((tab) => tab.active) || null;
      const sourceExists = Boolean(await chrome.tabs.get(sourceTabId).catch(() => null));
      return {
        sourceExists,
        activeTab,
        tabs: tabs.map((tab) => ({
          id: tab.id,
          active: tab.active === true,
          url: tab.url || "",
          status: tab.status || null,
        })),
      };
    }, { sourceWindowId, sourceTabId });

    const targetTabs = lastState.tabs.filter((tab) => sameUrl(tab.url, targetUrl));
    const activeTarget = targetTabs.some((tab) => tab.active === true);
    const expectedSourceState =
      targetHint === "_blank" ? lastState.sourceExists === true : true;

    if (activeTarget && expectedSourceState) {
      return lastState;
    }

    await sleep(200);
  }

  return lastState || { sourceExists: null, activeTab: null, tabs: [] };
}

async function cleanupScenarioTabs(serviceWorker, { sourceTabId, targetUrl }) {
  await swEval(serviceWorker, async ({ sourceTabId, targetUrl }) => {
    const tabs = await chrome.tabs.query({});
    const removableIds = tabs
      .filter((tab) => tab.id === sourceTabId || tab.url === targetUrl)
      .map((tab) => tab.id)
      .filter((tabId) => Number.isFinite(tabId));

    if (removableIds.length > 0) {
      await chrome.tabs.remove(removableIds).catch(() => {});
    }
    return true;
  }, { sourceTabId, targetUrl });
}

async function getDebugEventCount(serviceWorker) {
  const events = await swEval(serviceWorker, async () =>
    globalThis.ZeroLatencyDebugEvents?.snapshot?.(500) ?? []
  );
  return Array.isArray(events) ? events.length : 0;
}

async function getRelatedDebugEvents(serviceWorker, { targetUrl, afterIndex }) {
  const events = await swEval(serviceWorker, async () =>
    globalThis.ZeroLatencyDebugEvents?.snapshot?.(500) ?? []
  );
  void afterIndex;
  return (Array.isArray(events) ? events : []).filter((event) =>
    JSON.stringify(event).includes(targetUrl)
  );
}

function includesEventName(event, namePart) {
  return getEventName(event).includes(namePart);
}

async function waitForTabComplete(serviceWorker, tabId, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await swEval(serviceWorker, async ({ tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      return { status: tab.status, url: tab.url };
    }, { tabId });

    if (status.status === "complete") {
      await sleep(500);
      return status;
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for tab ${tabId} to complete`);
}

async function prepareExtensionUnderTest() {
  await prepareClickInterceptExtension({
    extensionDir,
    targetDir: extensionUnderTestDir,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
