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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");

const runRoot = path.join(
  os.tmpdir(),
  `zlw-click-intercept-smoke-${process.pid}-${Date.now()}`
);
const profileDir = path.join(runRoot, "chromium-profile");
const extensionUnderTestDir = path.join(runRoot, "extension");

const chromiumPath = findFirstExistingExecutable(getSharedPlaywrightChromiumPathCandidates());

const SCENARIOS = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  sourceHost: `click-source-${index + 1}.test`,
  targetHost: `click-target-${index + 1}.test`,
  targetHint: "_self",
}));

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
      results.push(await runClickScenario({ debugPort, serviceWorker, scenario, clients }));
      console.error(`[click-smoke] scenario ${scenario.id}/${scenarios.length}: done`);
    }

    const failed = results.filter((result) => !result.ok);
    const summary = {
      ok: failed.length === 0,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      swallowedClicks: results.filter((result) => result.swallowed).length,
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

async function runClickScenario({ debugPort, serviceWorker, scenario, clients }) {
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
  const ok = finalReachedTarget && !swallowed;

  await cleanupScenarioTabs(serviceWorker, {
    sourceTabId: source.tabId,
    targetUrl: scenario.targetUrl,
  });
  console.error(`[click-smoke] ${scenario.id}: ok=${ok} swallowed=${swallowed}`);

  return {
    id: scenario.id,
    targetHint: scenario.targetHint,
    sourceUrl: scenario.sourceUrl,
    targetUrl: scenario.targetUrl,
    ok,
    swallowed,
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

async function setupExtensionState(serviceWorker) {
  await swEval(serviceWorker, async () => {
    const settings = globalThis.ZeroLatencySettings.cloneSettings(
      globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
    );
    settings.tracking.excludeHttpPages = false;
    settings.tracking.excludeLocalPages = false;
    settings.tracking.excludePrivateNetworkPages = false;
    settings.preloading.enabled = true;
    settings.preloading.realPreloadEnabled = true;
    settings.preloading.aiPrediction.enabled = false;
    settings.preloadWindow.watchdogEnabled = true;
    settings.experiments.crossSiteCurrentTabSwap = true;
    settings.diagnostics.enabled = true;
    settings.layout.ruleCards.items.perPagePreloadLimit.valueC = 3;
    settings.layout.ruleCards.items.highWeightRankTab.valueC = 3;

    const storedSettings = await globalThis.ZeroLatencySettings.saveSettings(
      chrome.storage.local,
      settings
    );
    globalThis.backgroundState.setCachedSettings(storedSettings);

    const serviceState = await loadServiceState();
    serviceState.paused = false;
    serviceState.updatedAt = new Date().toISOString();
    await saveServiceState(serviceState);

    await globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();
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
