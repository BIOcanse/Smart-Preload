import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");

const runRoot = path.join(
  os.tmpdir(),
  `zlw-click-intercept-smoke-${process.pid}-${Date.now()}`
);
const profileDir = path.join(runRoot, "chrome-profile");
const extensionUnderTestDir = path.join(runRoot, "extension");

const chromePathCandidates = [
  path.join(process.env.LocalAppData || "", "ms-playwright", "chromium-1217", "chrome-win64", "chrome.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.LocalAppData || "", "Google", "Chrome", "Application", "chrome.exe"),
];

const SCENARIOS = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  sourceHost: `click-source-${index + 1}.test`,
  targetHost: `click-target-${index + 1}.test`,
  targetHint: "_self",
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await rm(runRoot, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  await prepareExtensionUnderTest();

  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  const scenarios = buildScenarioUrls(webPort);
  const server = await startTestServer(webPort, scenarios);
  const chrome = launchChrome({ debugPort, scenarios });
  const clients = [];

  try {
    const serviceWorkerTarget = await waitForExtensionServiceWorker(debugPort);
    const serviceWorker = serviceWorkerTarget.client;
    clients.push(serviceWorker);

    await waitForBackgroundReady(serviceWorker);
    await setupExtensionState(serviceWorker);

    const results = [];

    for (const scenario of scenarios) {
      results.push(await runClickScenario({ debugPort, serviceWorker, scenario, clients }));
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
    await closeChrome({ chrome, debugPort });
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
  const source = await swEval(serviceWorker, async ({ sourceUrl }) => {
    const createdTab = await chrome.tabs.create({ url: sourceUrl, active: true });
    await chrome.windows.update(createdTab.windowId, { focused: true });
    return {
      tabId: createdTab.id,
      windowId: createdTab.windowId,
    };
  }, { sourceUrl: scenario.sourceUrl });

  await waitForTabComplete(serviceWorker, source.tabId);
  const pageTarget = await waitForTarget(
    debugPort,
    (target) => target.type === "page" && stripHash(target.url) === stripHash(scenario.sourceUrl)
  );
  const page = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  clients.push(page);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.bringToFront");
  const clickPoint = await waitForClickPoint(page);
  await dispatchMouseMove(page, clickPoint);
  await sleep(600);
  await dispatchMouseMove(page, {
    x: clickPoint.x + 1,
    y: clickPoint.y + 1,
  });
  await sleep(250);

  await requestCandidateRefresh(serviceWorker, source.tabId);
  const preloadBeforeClick = await waitForPreloadedTarget(
    serviceWorker,
    source.tabId,
    scenario.targetUrl
  );

  const beforeEventCount = await getDebugEventCount(serviceWorker);

  await dispatchRealClick(page, clickPoint);

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
    settings.preloading.enabled = true;
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

async function waitForPreloadedTarget(serviceWorker, sourceTabId, targetUrl, timeoutMs = 12000) {
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
      targetHint === "_blank" ? lastState.sourceExists === true : lastState.sourceExists === false;

    if (activeTarget && expectedSourceState) {
      return lastState;
    }

    await sleep(200);
  }

  return lastState || { sourceExists: null, activeTab: null, tabs: [] };
}

async function waitForClickPoint(page, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getClickPointState(page);
    if (lastState?.found === true) {
      return lastState;
    }
    await sleep(100);
  }

  throw new Error(`target-link missing: ${JSON.stringify(lastState)}`);
}

async function getClickPointState(page) {
  return pageEval(page, () => {
    const link = document.getElementById("target-link");
    if (!link) {
      return {
        found: false,
        href: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyText: document.body?.innerText?.slice(0, 300) || "",
      };
    }
    const rect = link.getBoundingClientRect();
    return {
      found: true,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      href: link.href,
      target: link.target || "_self",
    };
  });
}

async function dispatchRealClick(page, point) {
  await dispatchMouseMove(page, point);
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}

async function dispatchMouseMove(page, point) {
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
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

function getEventName(event) {
  return String(event?.eventName || event?.event || event?.name || event?.type || "");
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
  const inspectedManifests = [];

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
        inspectedManifests.push({
          url: target.url,
          name: manifest?.name || null,
          permissions,
        });
        const isTargetExtension =
          permissions.includes("nativeMessaging") &&
          permissions.includes("bookmarks") &&
          permissions.includes("tabs") &&
          permissions.includes("windows");

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
    )}; inspected manifests: ${JSON.stringify(inspectedManifests.slice(-8), null, 2)}; inspection errors: ${JSON.stringify(inspectionErrors.slice(-8), null, 2)}`
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
      this.ws.addEventListener("error", (event) =>
        reject(event.error || new Error("WebSocket error"))
      );
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

function launchChrome({ debugPort, scenarios }) {
  const chromePath = chromePathCandidates.find((candidate) => candidate && existsSync(candidate));
  if (!chromePath) {
    throw new Error("Chrome executable was not found.");
  }

  const resolverRules = [...new Set(scenarios.flatMap((scenario) => [
    scenario.sourceHost,
    scenario.targetHost,
  ]))]
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(", ");
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    `--disable-extensions-except=${extensionUnderTestDir}`,
    `--load-extension=${extensionUnderTestDir}`,
    "--enable-unsafe-extension-debugging",
    `--host-resolver-rules=${resolverRules}`,
    "--proxy-server=direct://",
    "--proxy-bypass-list=*",
    "--no-first-run",
    "--no-sandbox",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-popup-blocking",
    "--disable-features=Translate,AutofillServerCommunication",
    "--window-size=1280,900",
    `${scenarios[0].sourceUrl}?startup=1`,
  ];

  const child = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function closeChrome({ chrome, debugPort }) {
  try {
    const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
    if (version?.webSocketDebuggerUrl) {
      const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
      try {
        await browser.send("Browser.close");
      } finally {
        browser.close();
      }
    }
  } catch (_error) {
    // Fall back to terminating the launcher process below.
  }

  if (!chrome.killed) {
    try {
      chrome.kill();
    } catch (_error) {
      // Ignore process cleanup errors.
    }
  }

  await waitForProcessExit(chrome, 5000);
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeoutMs),
  ]);
}

async function rmWithRetry(targetPath, attempts = 8) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(250 * attempt);
    }
  }

  throw lastError;
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

async function startTestServer(port, scenarios) {
  const scenarioBySourcePath = new Map(
    scenarios.map((scenario) => [`${scenario.sourceHost}/source/${scenario.id}`, scenario])
  );
  const scenarioByTargetPath = new Map(
    scenarios.map((scenario) => [`${scenario.targetHost}/target/${scenario.id}`, scenario])
  );

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    const host = (request.headers.host || "").split(":")[0];
    const key = `${host}${requestUrl.pathname}`;
    response.setHeader("Cache-Control", "no-store");

    if (scenarioBySourcePath.has(key)) {
      respondHtml(response, renderSourcePage(scenarioBySourcePath.get(key)));
      return;
    }

    if (scenarioByTargetPath.has(key)) {
      respondHtml(response, renderTargetPage(scenarioByTargetPath.get(key)));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function renderSourcePage(scenario) {
  const targetAttr = scenario.targetHint === "_blank" ? ' target="_blank"' : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Source ${scenario.id}</title>
    <style>
      body { font-family: sans-serif; margin: 40px; }
      a { display: inline-block; padding: 18px 24px; font-size: 20px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Source ${scenario.id}</h1>
      <a id="target-link" href="${escapeHtml(scenario.targetUrl)}"${targetAttr}>Open target ${scenario.id}</a>
    </main>
  </body>
</html>`;
}

function renderTargetPage(scenario) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Target ${scenario.id}</title>
  </head>
  <body>
    <main>
      <h1 id="target-marker">Target ${scenario.id}</h1>
      <p>${escapeHtml(scenario.targetUrl)}</p>
    </main>
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

function sameUrl(actual, expected) {
  return stripHash(actual) === stripHash(expected);
}

function stripHash(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.href;
  } catch (_error) {
    return String(rawUrl || "");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
