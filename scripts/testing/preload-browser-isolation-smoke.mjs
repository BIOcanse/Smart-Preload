import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, pageEval, swEval } from "./lib/cdp-client.mjs";
import { waitForTarget } from "./lib/cdp-discovery.mjs";
import { startBrowserIsolationSite } from "./lib/browser-isolation-site.mjs";
import { prepareExtensionUnderTest as copyExtensionFixture } from "./lib/extension-fixture.mjs";
import { waitForZeroLatencyExtensionServiceWorker } from "./lib/extension-service-worker.mjs";
import { createNativeAppFixture } from "./lib/native-app-fixture.mjs";
import {
  configureRealPreloadTestState,
  requestCandidateRefresh,
  waitForBackgroundReady,
  waitForContextMenuHiddenEntry,
  waitForTabComplete,
} from "./lib/preload-extension-helpers.mjs";
import {
  buildExtensionBrowserArgs,
  closeBrowserByDebugPort,
  killBrowserProcessesForProfile,
  spawnBrowser,
  stopProcess,
} from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getEdgePathCandidates,
  getPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import {
  createHostResolverRules,
  getEventName,
  getFreePort,
  rmWithRetry,
  sleep,
  stripHash,
} from "./lib/test-utils.mjs";
import {
  closeNativeContextMenu,
  dispatchMouseMove,
  dispatchRightClick,
  dispatchSyntheticContextMenu,
  waitForLinkPoint,
} from "./lib/cdp-input-helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");
const appDir = path.join(
  repoRoot,
  "dist",
  "staging",
  "release-v1.0.9",
  "zero-latency-web-app-v1.0.9"
);
const nativeAppFixture = createNativeAppFixture({ appDir });
const runRoot = path.join(
  os.tmpdir(),
  `zlw-browser-isolation-smoke-${process.pid}-${Date.now()}`
);

const browsers = [
  {
    name: "chromium",
    exe: findFirstExistingExecutable(getPlaywrightChromiumPathCandidates()) || "",
  },
  {
    name: "edge",
    exe: findFirstExistingExecutable(getEdgePathCandidates()) || "",
  },
];

async function main() {
  const availableBrowsers = browsers.filter((browser) => existsSync(browser.exe));

  if (availableBrowsers.length < 2) {
    throw new Error(
      `Chrome+Edge are required. Found: ${availableBrowsers.map((b) => b.name).join(", ")}`
    );
  }

  if (!nativeAppFixture.hasExecutable()) {
    throw new Error(`Local app executable not found: ${nativeAppFixture.appExe}`);
  }

  await rm(runRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });

  const webPort = await getFreePort();
  const server = await startBrowserIsolationSite(webPort);
  const sessions = [];
  const fileBackups = await nativeAppFixture.backupPortableFiles();
  const debugToken = `zlw-smoke-${process.pid}-${Date.now()}`;
  let appProcess = null;

  try {
    for (const browser of availableBrowsers) {
      sessions.push(await launchBrowserSession(browser, webPort));
    }

    const origins = sessions.map((session) => session.extensionOrigin);
    await nativeAppFixture.writePortableTestAccess(origins, debugToken);
    appProcess = nativeAppFixture.launchHost();
    await nativeAppFixture.waitForHealth(debugToken);

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

    const appWindows = await nativeAppFixture.fetchDebugJson(
      "/api/v1/windows/chrome",
      debugToken
    ).catch(() => []);
    const summary = {
      ok: results.every((result) => result.ok),
      appHealth: await nativeAppFixture.fetchDebugJson("/health", debugToken).catch((error) => ({
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
    await nativeAppFixture.restorePortableFiles(fileBackups);
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
  const resolverRules = createHostResolverRules([sourceHost, hiddenHost]);
  const sourceUrl = `http://${sourceHost}:${webPort}/source/${browser.name}`;
  const child = spawnBrowser(
    browser.exe,
    buildExtensionBrowserArgs({
      profileDir,
      debugPort,
      extensionDir: extensionUnderTestDir,
      resolverRules,
      startUrl: sourceUrl,
    }),
    { windowsHide: true }
  );

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
  const appMonitor = await nativeAppFixture.fetchDebugJson(
    "/api/v1/windows/monitor-snapshot-read",
    debugToken
  ).catch(() => null);
  const eventNames = state.events.map((event) => getEventName(event)).filter(Boolean);
  const hiddenEntries = state.hiddenEntries;
  const nativeEntries = [...state.prerenderEntries, ...state.prefetchEntries];
  const hiddenUrls = new Set(hiddenEntries.map((entry) => entry.requestedUrl));
  const nativeUrls = new Set(nativeEntries.map((entry) => entry.requestedUrl));
  const overlap = [...hiddenUrls].filter((url) => nativeUrls.has(url));
  const contextMenuNewTab = await runContextMenuNavigationScenario(session, source, {
    mode: "new-tab",
    linkId: "hidden-link-1",
    targetUrl: `http://${session.hiddenHost}:${webPort}/hidden/${session.name}/1`,
  });
  const contextMenuNewWindow = await runContextMenuNavigationScenario(session, source, {
    mode: "new-window",
    linkId: "hidden-link-2",
    targetUrl: `http://${session.hiddenHost}:${webPort}/hidden/${session.name}/2`,
  });
  const ok =
    hiddenEntries.length > 0 &&
    nativeEntries.length > 0 &&
    overlap.length === 0 &&
    contextMenuNewTab.ok &&
    contextMenuNewWindow.ok &&
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
    contextMenuNewTab,
    contextMenuNewWindow,
    schedulerSignals: state.scoreSignals,
    eventNames,
    appTrackedHiddenWindowCount: Array.isArray(appMonitor?.trackedWindows)
      ? appMonitor.trackedWindows.length
      : null,
  };
}

async function runContextMenuNavigationScenario(session, source, scenario) {
  await swEval(
    session.serviceWorker,
    async ({ tabId, windowId }) => {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(windowId, { focused: true });
      return true;
    },
    { tabId: source.tabId, windowId: source.windowId }
  );
  const pageTarget = await waitForTarget(
    session.debugPort,
    (target) => target.type === "page" && stripHash(target.url) === stripHash(session.sourceUrl)
  );
  const page = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  session.clients.push(page);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.bringToFront");

  const point = await waitForLinkPoint(page, scenario.linkId);
  await dispatchRightClick(page, point);
  await closeNativeContextMenu(page);

  let contextMenuDispatchMode = "cdp-right-click";
  let contextMenuEntry = await waitForContextMenuHiddenEntry(
    session.serviceWorker,
    source.tabId,
    scenario.targetUrl,
    2500
  ).catch(async () => {
    contextMenuDispatchMode = "dom-contextmenu-fallback";
    await dispatchSyntheticContextMenu(page, scenario.linkId);
    return waitForContextMenuHiddenEntry(session.serviceWorker, source.tabId, scenario.targetUrl);
  });
  const createdTarget = await swEval(
    session.serviceWorker,
    async ({ mode, sourceTabId, sourceWindowId, targetUrl }) => {
      let tab = null;
      let windowId = sourceWindowId;

      if (mode === "new-window") {
        const createdWindow = await chrome.windows.create({
          url: targetUrl,
          focused: false,
        });
        windowId = createdWindow.id;
        tab =
          (Array.isArray(createdWindow.tabs) && createdWindow.tabs[0]) ||
          (await chrome.tabs.query({ windowId }).then((tabs) => tabs[0]));
      } else {
        tab = await chrome.tabs.create({
          url: targetUrl,
          openerTabId: sourceTabId,
          active: false,
        });
      }

      const eventTab = {
        ...tab,
        openerTabId: sourceTabId,
        pendingUrl: tab.pendingUrl || tab.url || targetUrl,
      };
      const activation =
        await globalThis.ZeroLatencyPreloadRuntimeManager.activateCreatedNavigationTarget(
          {
            sourceTabId,
            tabId: tab.id,
            url: eventTab.pendingUrl || targetUrl,
            timeStamp: Date.now(),
          },
          {
            requireContextMenuInteractionPreload: true,
          }
        );
      return {
        tabId: tab.id,
        windowId,
        openerTabId: tab.openerTabId ?? null,
        url: tab.pendingUrl || tab.url || "",
        activation,
      };
    },
    {
      mode: scenario.mode,
      sourceTabId: source.tabId,
      sourceWindowId: source.windowId,
      targetUrl: scenario.targetUrl,
    }
  );
  const expectedWindowId =
    scenario.mode === "new-window" ? createdTarget.windowId : source.windowId;
  const finalState = await waitForContextMenuFallbackActivation(
    session.serviceWorker,
    {
      windowId: expectedWindowId,
      createdTabId: createdTarget.tabId,
      targetUrl: scenario.targetUrl,
    }
  );
  const finalPreloadState = await readPreloadState(session.serviceWorker, source);
  const finalHiddenUrls = new Set(
    finalPreloadState.hiddenEntries.map((entry) => entry.requestedUrl)
  );
  const finalNativeUrls = new Set(
    [...finalPreloadState.prerenderEntries, ...finalPreloadState.prefetchEntries].map(
      (entry) => entry.requestedUrl
    )
  );
  const finalOverlap = [...finalHiddenUrls].filter((url) => finalNativeUrls.has(url));
  const relatedEvents = finalPreloadState.events.filter((event) =>
    JSON.stringify(event).includes(scenario.targetUrl)
  );
  const fallbackActivated = relatedEvents.some((event) =>
    getEventName(event).includes("contextmenu-preload-activated")
  );
  const activationSucceeded = relatedEvents.some((event) =>
    getEventName(event).includes("preload-activation.success")
  );
  const ok =
    contextMenuEntry.found &&
    (scenario.mode === "new-window" || createdTarget.openerTabId === source.tabId) &&
    finalState.createdTabClosed &&
    finalState.activeTarget &&
    finalState.activeTargetWindowId === expectedWindowId &&
    finalOverlap.length === 0 &&
    (createdTarget.activation?.handled === true || fallbackActivated || activationSucceeded);

  return {
    ok,
    mode: scenario.mode,
    targetUrl: scenario.targetUrl,
    expectedWindowId,
    contextMenuDispatchMode,
    contextMenuEntry,
    createdTarget,
    createdTabClosed: finalState.createdTabClosed,
    activeTarget: finalState.activeTarget,
    activeTargetTabId: finalState.activeTargetTabId,
    activeTargetWindowId: finalState.activeTargetWindowId,
    finalOverlap,
    fallbackActivated,
    activationSucceeded,
    eventNames: relatedEvents.map(getEventName).filter(Boolean),
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

async function waitForContextMenuFallbackActivation(
  serviceWorker,
  { windowId, createdTabId, targetUrl },
  timeoutMs = 8000
) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastState = await swEval(
        serviceWorker,
        async ({ windowId, createdTabId, targetUrl }) => {
          const tabs = await chrome.tabs.query({ windowId });
          const createdTab = Number.isFinite(createdTabId)
            ? await chrome.tabs.get(createdTabId).catch(() => null)
            : null;
          const activeTarget = tabs.find(
            (tab) =>
              tab.active === true && stripHashForSmoke(tab.url) === stripHashForSmoke(targetUrl)
          );
          return {
            createdTabClosed: createdTab === null,
            activeTarget: Boolean(activeTarget),
            activeTargetTabId: activeTarget?.id ?? null,
            activeTargetWindowId: activeTarget?.windowId ?? null,
            activeUrl: activeTarget?.url ?? null,
          };

          function stripHashForSmoke(value) {
            try {
              const parsedUrl = new URL(value);
              parsedUrl.hash = "";
              return parsedUrl.href;
            } catch {
              return String(value || "");
            }
          }
        },
        { windowId, createdTabId, targetUrl },
        { timeoutMs: 2500 }
      );
    } catch (error) {
      lastState = {
        createdTabClosed: false,
        activeTarget: false,
        activeTargetWindowId: null,
        transientError: error instanceof Error ? error.message : String(error),
      };
    }

    if (lastState.createdTabClosed && lastState.activeTarget) {
      return lastState;
    }

    await sleep(200);
  }

  return lastState || { createdTabClosed: false, activeTarget: false, activeTargetWindowId: null };
}

async function readPreloadState(serviceWorker, source) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await swEval(
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
        { sourceTabId: source.tabId, sourceWindowId: source.windowId },
        { timeoutMs: 6000 }
      );
    } catch (error) {
      lastError = error;
      await sleep(300 * attempt);
    }
  }

  throw lastError ?? new Error("Failed to read preload state");
}

async function setupExtensionState(serviceWorker) {
  await configureRealPreloadTestState(serviceWorker, {
    diagnosticsEnabled: true,
    preloadWindowWatchdogEnabled: true,
    forceMinimize: false,
    nativeTotalSlots: 8,
    tabTotalSlots: 8,
    nativePerPageSlots: 8,
    tabPerPageSlots: 8,
  });
}

async function waitForExtensionServiceWorker(debugPort, timeoutMs = 20000) {
  return waitForZeroLatencyExtensionServiceWorker({
    debugPort,
    timeoutMs,
    requiredPermissions: ["nativeMessaging", "tabs", "windows"],
  });
}

async function closeBrowserSession(session) {
  for (const client of session.clients.reverse()) {
    client.close();
  }

  await closeBrowserByDebugPort({
    child: session.child,
    debugPort: session.debugPort,
  });
  await killBrowserProcessesForProfile(session.profileDir);
}

async function prepareExtensionUnderTest(targetDir) {
  await copyExtensionFixture({
    extensionDir,
    targetDir,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
