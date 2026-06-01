import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");
const appDir = path.join(
  repoRoot,
  "dist",
  "staging",
  "zero-latency-web-app-v1.0.4"
);
const appExe = path.join(appDir, "zero-latency-web-app.exe");
const portableDir = path.join(appDir, "portable");
const allowedOriginPath = path.join(portableDir, "allowed-extension-origin.txt");
const allowedOriginsPath = path.join(portableDir, "allowed-extension-origins.txt");
const debugTokenPath = path.join(portableDir, "debug-api-token.txt");
const runRoot = path.join(
  os.tmpdir(),
  `zlw-browser-isolation-smoke-${process.pid}-${Date.now()}`
);

const browsers = [
  {
    name: "chromium",
    exe: path.join(
      process.env.LocalAppData || "",
      "ms-playwright",
      "chromium-1217",
      "chrome-win64",
      "chrome.exe"
    ),
  },
  {
    name: "edge",
    exe: path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const availableBrowsers = browsers.filter((browser) => existsSync(browser.exe));

  if (availableBrowsers.length < 2) {
    throw new Error(
      `Chrome+Edge are required. Found: ${availableBrowsers.map((b) => b.name).join(", ")}`
    );
  }

  if (!existsSync(appExe)) {
    throw new Error(`Local app executable not found: ${appExe}`);
  }

  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  const webPort = await getFreePort();
  const server = await startTestServer(webPort);
  const sessions = [];
  const fileBackups = await backupPortableFiles();
  const debugToken = `zlw-smoke-${process.pid}-${Date.now()}`;
  let appProcess = null;

  try {
    for (const browser of availableBrowsers) {
      sessions.push(await launchBrowserSession(browser, webPort));
    }

    const origins = sessions.map((session) => session.extensionOrigin);
    await writePortableTestAccess(origins, debugToken);
    appProcess = launchLocalAppHost();
    await waitForNativeAppHealth(debugToken);

    for (const session of sessions) {
      await setupExtensionState(session.serviceWorker);
      await swEval(session.serviceWorker, async () => {
        await globalThis.ZeroLatencyNativeAppRequestModules.ensureNativeAppRegistration();
        await globalThis.ZeroLatencyNativeAppHeartbeat?.send?.("manual:isolation-smoke");
        return true;
      });
    }

    const results = [];

    for (const session of sessions) {
      results.push(await runBrowserPreloadScenario(session, webPort, debugToken));
    }

    const appWindows = await fetchNativeAppDebugJson(
      "/api/v1/windows/chrome",
      debugToken
    ).catch(() => []);
    const summary = {
      ok: results.every((result) => result.ok),
      appHealth: await fetchNativeAppDebugJson("/health", debugToken).catch((error) => ({
        ok: false,
        error: error.message,
      })),
      appWindowCount: Array.isArray(appWindows) ? appWindows.length : null,
      browserCount: results.length,
      results,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    for (const session of sessions.reverse()) {
      await closeBrowserSession(session);
    }
    if (appProcess) {
      await stopProcess(appProcess);
    }
    await restorePortableFiles(fileBackups);
    server.close();
    await killBrowserProcessesForProfile(runRoot);
    await rmWithRetry(runRoot);
  }
}

async function launchBrowserSession(browser, webPort) {
  const profileDir = path.join(runRoot, browser.name, "profile");
  const extensionUnderTestDir = path.join(runRoot, browser.name, "extension");
  const debugPort = await getFreePort();

  await mkdir(profileDir, { recursive: true });
  await prepareExtensionUnderTest(extensionUnderTestDir);

  const sourceHost = `${browser.name}-source.test`;
  const hiddenHost = `${browser.name}-hidden.test`;
  const resolverRules = [sourceHost, hiddenHost]
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(", ");
  const sourceUrl = `http://${sourceHost}:${webPort}/source/${browser.name}`;
  const child = spawn(
    browser.exe,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      `--disable-extensions-except=${extensionUnderTestDir}`,
      `--load-extension=${extensionUnderTestDir}`,
      "--enable-extensions",
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
      "--disable-features=Translate,AutofillServerCommunication,DisableLoadExtensionCommandLineSwitch",
      "--window-size=1280,900",
      sourceUrl,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  );

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const serviceWorkerTarget = await waitForExtensionServiceWorker(debugPort);
  const extensionId = serviceWorkerTarget.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  const extensionOrigin = extensionId ? `chrome-extension://${extensionId}` : null;

  if (!extensionOrigin) {
    throw new Error(`Unable to resolve extension origin from ${serviceWorkerTarget.url}`);
  }
  const serviceWorker = serviceWorkerTarget.client;

  await waitForBackgroundReady(serviceWorker);

  return {
    ...browser,
    child,
    debugPort,
    profileDir,
    sourceHost,
    hiddenHost,
    sourceUrl,
    extensionOrigin,
    extensionUnderTestDir,
    serviceWorker,
    clients: [serviceWorker],
  };
}

async function runBrowserPreloadScenario(session, webPort, debugToken) {
  const source = await swEval(
    session.serviceWorker,
    async ({ sourceUrl }) => {
      const tabs = await chrome.tabs.query({ url: sourceUrl });
      const tab =
        tabs[0] ?? (await chrome.tabs.create({ url: sourceUrl, active: true }));
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { tabId: tab.id, windowId: tab.windowId };
    },
    { sourceUrl: session.sourceUrl }
  );

  await waitForTabComplete(session.serviceWorker, source.tabId);
  await requestCandidateRefresh(session.serviceWorker, source.tabId);
  const state = await waitForPreloadState(session, source, webPort);
  const appMonitor = await fetchNativeAppDebugJson(
    "/api/v1/windows/monitor-snapshot-read",
    debugToken
  ).catch(() => null);
  const eventNames = state.events.map((event) => getEventName(event)).filter(Boolean);
  const hiddenEntries = state.hiddenEntries;
  const nativeEntries = [...state.prerenderEntries, ...state.prefetchEntries];
  const hiddenUrls = new Set(hiddenEntries.map((entry) => entry.requestedUrl));
  const nativeUrls = new Set(nativeEntries.map((entry) => entry.requestedUrl));
  const overlap = [...hiddenUrls].filter((url) => nativeUrls.has(url));
  const ok =
    hiddenEntries.length > 0 &&
    nativeEntries.length > 0 &&
    overlap.length === 0 &&
    state.preloadWindow.windowId !== null &&
    state.preloadWindow.hiddenBySystem === true &&
    state.preloadWindow.hwnd !== null &&
    eventNames.includes("native-app.registration.success") &&
    eventNames.includes("native-app.windows.hide.result");

  return {
    browser: session.name,
    ok,
    extensionOrigin: session.extensionOrigin,
    sourceTabId: source.tabId,
    sourceWindowId: source.windowId,
    preloadWindow: state.preloadWindow,
    preloadWindowVisible: state.preloadWindowVisible,
    hiddenCount: hiddenEntries.length,
    prerenderCount: state.prerenderEntries.length,
    prefetchCount: state.prefetchEntries.length,
    hiddenUrls: [...hiddenUrls],
    nativeUrls: [...nativeUrls],
    overlap,
    schedulerSignals: state.scoreSignals,
    eventNames,
    appTrackedHiddenWindowCount: Array.isArray(appMonitor?.trackedWindows)
      ? appMonitor.trackedWindows.length
      : null,
  };
}

async function waitForPreloadState(session, source, webPort, timeoutMs = 16000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await readPreloadState(session.serviceWorker, source);

    if (
      lastState.hiddenEntries.length > 0 &&
      (lastState.prerenderEntries.length > 0 || lastState.prefetchEntries.length > 0) &&
      lastState.preloadWindow.windowId !== null &&
      lastState.preloadWindow.hiddenBySystem === true &&
      lastState.preloadWindow.hwnd !== null
    ) {
      return lastState;
    }

    await requestCandidateRefresh(session.serviceWorker, source.tabId);
    await sleep(700);
  }

  throw new Error(
    `${session.name} preload state did not converge: ${JSON.stringify(lastState, null, 2)}`
  );
}

async function readPreloadState(serviceWorker, source) {
  return swEval(
    serviceWorker,
    async ({ sourceTabId, sourceWindowId }) => {
      const preloadState = await loadPreloadState();
      const runtimeEntry = findSourceTabRuntime(preloadState, sourceTabId);
      const normalWindowRuntime = runtimeEntry?.normalWindowRuntime ?? null;
      const sourceRuntime = runtimeEntry?.sourceTabRuntime ?? null;
      const preloadWindow = normalWindowRuntime?.preloadWindow ?? {};
      const livePreloadWindow =
        preloadWindow.windowId != null
          ? await chrome.windows.get(preloadWindow.windowId).catch(() => null)
          : null;
      const snapshots = preloadState.scheduler?.candidateSelectionSnapshotsByTabId ?? {};
      const snapshot = snapshots[String(sourceTabId)] ?? null;
      const events = globalThis.ZeroLatencyDebugEvents?.snapshot?.(250) ?? [];

      return {
        sourceWindowId,
        preloadWindow: {
          windowId: preloadWindow.windowId ?? null,
          hwnd: preloadWindow.hwnd ?? null,
          hiddenBySystem: preloadWindow.hiddenBySystem === true,
          lastSystemHideError: preloadWindow.lastSystemHideError ?? null,
          systemHideFailureCount: preloadWindow.systemHideFailureCount ?? 0,
        },
        preloadWindowVisible:
          livePreloadWindow == null ? null : livePreloadWindow.state !== "minimized",
        hiddenEntries: Object.values(sourceRuntime?.hiddenTabEntriesByUrl || {}),
        prerenderEntries: Object.values(sourceRuntime?.prerenderEntriesByUrl || {}),
        prefetchEntries: Object.values(sourceRuntime?.prefetchEntriesByUrl || {}),
        scoreSignals: snapshot?.scoreSignals ?? null,
        events,
      };
    },
    { sourceTabId: source.tabId, sourceWindowId: source.windowId }
  );
}

async function setupExtensionState(serviceWorker) {
  await swEval(serviceWorker, async () => {
    const settings = globalThis.ZeroLatencySettings.cloneSettings(
      globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
    );
    settings.preloading.enabled = true;
    settings.preloading.aiPrediction.enabled = false;
    settings.preloadWindow.watchdogEnabled = true;
    settings.preloadWindow.forceMinimize = false;
    settings.experiments.crossSiteCurrentTabSwap = true;
    settings.diagnostics.enabled = true;
    settings.layout.ruleCards.items.perPagePreloadLimit.valueC = 8;
    settings.layout.ruleCards.items.highWeightRankTab.valueC = 8;
    settings.preloading.scheduler.nativeTotalMin = 8;
    settings.preloading.scheduler.nativeTotalMax = 8;
    settings.preloading.scheduler.tabTotalMin = 8;
    settings.preloading.scheduler.tabTotalMax = 8;

    const storedSettings = await globalThis.ZeroLatencySettings.saveSettings(
      chrome.storage.local,
      settings
    );
    globalThis.backgroundState.setCachedSettings(storedSettings);

    const serviceState = await loadServiceState();
    serviceState.paused = false;
    serviceState.updatedAt = new Date().toISOString();
    await saveServiceState(serviceState);

    await savePreloadState(createEmptyPreloadState());
    await globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();
    return true;
  });
}

async function requestCandidateRefresh(serviceWorker, tabId) {
  await swEval(
    serviceWorker,
    async ({ tabId }) => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "preload:collect-candidates" });
      } catch (_error) {
        // Runtime refresh below covers content-script injection races.
      }
      await requestPreloadCandidateRefreshForOpenTabs();
      return true;
    },
    { tabId }
  );
}

async function waitForTabComplete(serviceWorker, tabId, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await swEval(
      serviceWorker,
      async ({ tabId }) => chrome.tabs.get(tabId),
      { tabId }
    );

    if (tab.status === "complete") {
      await sleep(500);
      return tab;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for tab ${tabId} to complete`);
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

async function waitForExtensionServiceWorker(debugPort, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastTargets = [];
  const inspectedManifests = [];
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
        const isTargetExtension =
          permissions.includes("nativeMessaging") &&
          permissions.includes("tabs") &&
          permissions.includes("windows");

        if (isTargetExtension) {
          return { ...target, manifest, client };
        }
        inspectedManifests.push({
          url: target.url,
          name: manifest?.name || null,
          permissions,
        });
      } catch (_error) {
        inspectionErrors.push({
          url: target.url,
          error: _error?.message || String(_error),
        });
        // Keep scanning; this may be a browser-managed extension worker.
      }

      client.close();
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for Zero-Latency Web service worker: ${JSON.stringify(
      lastTargets.map((target) => ({
        type: target.type,
        url: target.url,
        title: target.title,
      })),
      null,
      2
    )}; inspected=${JSON.stringify(inspectedManifests.slice(-8), null, 2)}; errors=${JSON.stringify(
      inspectionErrors.slice(-8),
      null,
      2
    )}`
  );
}

async function swEval(client, fn, arg = {}) {
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

async function fetchNativeAppDebugJson(pathname, debugToken) {
  const response = await fetch(`http://127.0.0.1:45831${pathname}`, {
    method: pathname.includes("monitor-snapshot") ? "POST" : "GET",
    headers: {
      "X-ZLW-Debug-Token": debugToken,
      Origin: "http://127.0.0.1:45831",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`);
  }

  return response.json();
}

async function waitForNativeAppHealth(debugToken, timeoutMs = 12000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchNativeAppDebugJson("/health", debugToken);
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  throw lastError || new Error("native app health timeout");
}

function launchLocalAppHost() {
  const child = spawn(appExe, ["--host"], {
    cwd: appDir,
    env: {
      ...process.env,
      ZLW_DEBUG_FORCE_HOST: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function backupPortableFiles() {
  return {
    allowedOrigin: await readMaybe(allowedOriginPath),
    allowedOrigins: await readMaybe(allowedOriginsPath),
    debugToken: await readMaybe(debugTokenPath),
  };
}

async function writePortableTestAccess(origins, debugToken) {
  await mkdir(portableDir, { recursive: true });
  const existingOrigins = [
    ...(await readMaybe(allowedOriginPath)).split(/\r?\n/),
    ...(await readMaybe(allowedOriginsPath)).split(/\r?\n/),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const nextOrigins = [...new Set([...existingOrigins, ...origins])].join("\n") + "\n";
  await writeFile(allowedOriginPath, nextOrigins, "utf8");
  await writeFile(allowedOriginsPath, nextOrigins, "utf8");
  await writeFile(debugTokenPath, `${debugToken}\n`, "utf8");
}

async function restorePortableFiles(backups) {
  await restoreMaybe(allowedOriginPath, backups.allowedOrigin);
  await restoreMaybe(allowedOriginsPath, backups.allowedOrigins);
  await restoreMaybe(debugTokenPath, backups.debugToken);
}

async function readMaybe(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (_error) {
    return "";
  }
}

async function restoreMaybe(filePath, contents) {
  if (contents) {
    await writeFile(filePath, contents, "utf8");
    return;
  }

  await rm(filePath, { force: true });
}

async function closeBrowserSession(session) {
  for (const client of session.clients.reverse()) {
    client.close();
  }

  try {
    const version = await fetchJson(`http://127.0.0.1:${session.debugPort}/json/version`);
    if (version?.webSocketDebuggerUrl) {
      const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
      try {
        await browser.send("Browser.close");
      } finally {
        browser.close();
      }
    }
  } catch (_error) {
    // Fall back to process kill below.
  }

  await stopProcess(session.child);
  await killBrowserProcessesForProfile(session.profileDir);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const pid = child.pid;

  try {
    child.kill();
  } catch (_error) {
    // Ignore cleanup errors.
  }

  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5000)]);

  if (process.platform === "win32" && pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
  }
}

async function killBrowserProcessesForProfile(commandLineNeedle) {
  if (process.platform !== "win32" || !commandLineNeedle) {
    return;
  }

  const escapedProfileDir = commandLineNeedle.replaceAll("'", "''");
  const command = [
    "$needle = '" + escapedProfileDir + "';",
    "Get-CimInstance Win32_Process -Filter \"name='chrome.exe' or name='msedge.exe'\" |",
    "Where-Object { $_.CommandLine -like \"*$needle*\" } |",
    "ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }",
  ].join(" ");

  await new Promise((resolve) => {
    const killer = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("exit", resolve);
    killer.once("error", resolve);
  });
  await sleep(1000);
}

async function prepareExtensionUnderTest(targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

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
    const target = path.join(targetDir, entry);
    if (!existsSync(source)) {
      continue;
    }
    await cp(source, target, { recursive: true, force: true });
  }
}

async function startTestServer(port) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    response.setHeader("Cache-Control", "no-store");

    if (requestUrl.pathname.startsWith("/source/")) {
      respondHtml(response, renderSourcePage(request.headers.host || "", requestUrl.pathname));
      return;
    }

    if (
      requestUrl.pathname.startsWith("/native/") ||
      requestUrl.pathname.startsWith("/hidden/")
    ) {
      respondHtml(response, renderTargetPage(request.headers.host || "", requestUrl.pathname));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

function renderSourcePage(hostHeader, pathname) {
  const [host, port] = hostHeader.split(":");
  const browserName = pathname.split("/").filter(Boolean)[1] || "browser";
  const hiddenHost = `${browserName}-hidden.test`;
  const nativeUrls = Array.from(
    { length: 5 },
    (_, index) => `http://${host}:${port}/native/${browserName}/${index + 1}`
  );
  const hiddenUrls = Array.from(
    { length: 5 },
    (_, index) => `http://${hiddenHost}:${port}/hidden/${browserName}/${index + 1}`
  );
  const links = [
    ...nativeUrls.map((url, index) => `<a href="${url}">Native ${index + 1}</a>`),
    ...hiddenUrls.map((url, index) => `<a href="${url}">Hidden ${index + 1}</a>`),
  ].join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>ZLW ${browserName} source</title>
    <style>
      body { font-family: sans-serif; margin: 32px; }
      a { display: block; margin: 10px 0; padding: 10px; font-size: 18px; }
    </style>
  </head>
  <body>
    <h1>ZLW ${browserName} source</h1>
    ${links}
  </body>
</html>`;
}

function renderTargetPage(hostHeader, pathname) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>${escapeHtml(pathname)}</title></head>
  <body><h1>${escapeHtml(hostHeader)} ${escapeHtml(pathname)}</h1></body>
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

function getEventName(event) {
  return String(event?.eventName || event?.event || event?.name || event?.type || "");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
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

async function rmWithRetry(targetPath, attempts = 8) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(500 * attempt);
    }
  }

  throw lastError;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
