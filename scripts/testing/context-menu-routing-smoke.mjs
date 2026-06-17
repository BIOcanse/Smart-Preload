import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { swEval } from "./lib/cdp-client.mjs";
import { startBrowserIsolationSite } from "./lib/browser-isolation-site.mjs";
import { prepareExtensionUnderTest } from "./lib/extension-fixture.mjs";
import { waitForZeroLatencyExtensionServiceWorker } from "./lib/extension-service-worker.mjs";
import {
  buildExtensionBrowserArgs,
  closeBrowserByDebugPort,
  killBrowserProcessesForProfile,
  spawnBrowser,
} from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import {
  configureRealPreloadTestState,
  waitForBackgroundReady,
  waitForContextMenuHiddenEntry,
  waitForTabComplete,
} from "./lib/preload-extension-helpers.mjs";
import {
  createHostResolverRules,
  getEventName,
  getFreePort,
  rmWithRetry,
  sameUrl,
  sleep,
} from "./lib/test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extension");
const runRoot = path.join(
  os.tmpdir(),
  `zlw-context-menu-routing-smoke-${process.pid}-${Date.now()}`
);
const profileDir = path.join(runRoot, "chromium-profile");
const extensionUnderTestDir = path.join(runRoot, "extension");
const browserExe = findFirstExistingExecutable(getPlaywrightChromiumPathCandidates());

const scenarios = [
  {
    id: "created-with-url",
    targetPath: "/hidden/chromium/1",
  },
  {
    id: "updated-after-blank",
    targetPath: "/hidden/chromium/2",
  },
];

async function main() {
  if (!browserExe || !existsSync(browserExe)) {
    throw new Error("Playwright Chromium executable was not found.");
  }

  await rm(runRoot, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  await prepareExtensionUnderTest({
    extensionDir,
    targetDir: extensionUnderTestDir,
  });

  const webPort = await getFreePort();
  const debugPort = await getFreePort();
  const sourceHost = "chromium-source.test";
  const hiddenHost = "chromium-hidden.test";
  const sourceUrl = `http://${sourceHost}:${webPort}/source/chromium`;
  const server = await startBrowserIsolationSite(webPort);
  const browser = spawnBrowser(
    browserExe,
    buildExtensionBrowserArgs({
      profileDir,
      debugPort,
      extensionDir: extensionUnderTestDir,
      resolverRules: createHostResolverRules([sourceHost, hiddenHost]),
      startUrl: sourceUrl,
    }),
    { windowsHide: true }
  );
  const clients = [];

  try {
    const serviceWorkerTarget = await waitForExtensionServiceWorker(debugPort);
    const serviceWorker = serviceWorkerTarget.client;
    clients.push(serviceWorker);
    await waitForBackgroundReady(serviceWorker);
    await configureRealPreloadTestState(serviceWorker, {
      diagnosticsEnabled: false,
      preloadWindowWatchdogEnabled: false,
      forceMinimize: true,
      nativeTotalSlots: 4,
      tabTotalSlots: 4,
      nativePerPageSlots: 4,
      tabPerPageSlots: 4,
    });

    const source = await ensureSourceTab(serviceWorker, sourceUrl);
    await waitForTabComplete(serviceWorker, source.tabId);

    const results = [];
    for (const scenario of scenarios) {
      results.push(
        await runRoutingScenario({
          serviceWorker,
          source,
          scenario: {
            ...scenario,
            targetUrl: `http://${hiddenHost}:${webPort}${scenario.targetPath}`,
          },
        })
      );
    }

    const summary = {
      ok: results.every((result) => result.ok),
      browser: "chromium",
      sourceUrl,
      results,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    for (const client of clients.reverse()) {
      client.close();
    }
    await closeBrowserByDebugPort({ child: browser, debugPort });
    server.close();
    await killBrowserProcessesForProfile(runRoot);
    await rmWithRetry(runRoot);
  }
}

async function runRoutingScenario({ serviceWorker, source, scenario }) {
  const preloadStart = await startContextMenuHiddenPreload(serviceWorker, {
    sourceTabId: source.tabId,
    targetUrl: scenario.targetUrl,
  });
  if (
    preloadStart?.queued !== true &&
    (preloadStart?.ok !== true || preloadStart?.strategy !== "hidden-tab")
  ) {
    const prereq = await readRoutingPrerequisites(serviceWorker);
    throw new Error(
      `${scenario.id} did not start hidden-tab contextmenu preload: ${JSON.stringify(
        { preloadStart, prereq }
      )}`
    );
  }
  const contextMenuEntry = await waitForContextMenuHiddenEntry(
    serviceWorker,
    source.tabId,
    scenario.targetUrl,
    60000
  );
  const strictContextMenuEntry = await readStrictContextMenuHiddenEntry(serviceWorker, {
    sourceWindowId: source.windowId,
    sourceTabId: source.tabId,
    targetUrl: scenario.targetUrl,
  });
  const beforeEventCount = await getDebugEventCount(serviceWorker);
  const createdTarget =
    scenario.id === "updated-after-blank"
      ? await createBlankThenUpdateTarget(serviceWorker, {
          sourceTabId: source.tabId,
          targetUrl: scenario.targetUrl,
        })
      : await createTargetWithUrl(serviceWorker, {
          sourceTabId: source.tabId,
          targetUrl: scenario.targetUrl,
        });
  const finalState = await waitForRoutedActivation(serviceWorker, {
    sourceWindowId: source.windowId,
    sourceTabId: source.tabId,
    createdTabId: createdTarget.tabId,
    targetUrl: scenario.targetUrl,
  });
  const relatedEvents = await getRelatedDebugEvents(serviceWorker, {
    targetUrl: scenario.targetUrl,
    afterIndex: beforeEventCount,
  });
  const debugEventsAfter = await getDebugEventsAfter(serviceWorker, beforeEventCount);
  const activationSucceeded = relatedEvents.some((event) =>
    getEventName(event).includes("preload-activation.success")
  );
  const ok =
    contextMenuEntry.found === true &&
    finalState.createdTabClosed === true &&
    finalState.sourceExists === true &&
    finalState.activeTarget === true &&
    activationSucceeded;

  return {
    id: scenario.id,
    ok,
    targetUrl: scenario.targetUrl,
    contextMenuEntry,
    strictContextMenuEntry,
    createdTarget,
    finalState,
    activationSucceeded,
    eventNames: relatedEvents.map(getEventName).filter(Boolean),
    eventDetails: ok ? undefined : compactDebugEvents(relatedEvents),
    debugEventsAfter: ok ? undefined : compactDebugEvents(debugEventsAfter),
  };
}

async function readStrictContextMenuHiddenEntry(
  serviceWorker,
  { sourceWindowId, sourceTabId, targetUrl }
) {
  return swEval(
    serviceWorker,
    async ({ sourceWindowId, sourceTabId, targetUrl }) => {
      const preloadState = await loadPreloadState();
      const runtimeEntry = getSourceTabRuntimeForWindow(
        preloadState,
        sourceWindowId,
        sourceTabId
      );
      const entry =
        runtimeEntry?.sourceTabRuntime?.hiddenTabEntriesByUrl?.[targetUrl] ?? null;
      return entry
        ? {
            found: true,
            normalWindowId: runtimeEntry?.normalWindowId ?? null,
            sourceTabId: runtimeEntry?.sourceTabRuntime?.sourceTabId ?? null,
            tabId: entry.tabId ?? null,
            status: entry.status ?? null,
            trigger: entry.interactionPreload?.trigger ?? null,
            requestedUrl: entry.requestedUrl ?? null,
          }
        : { found: false };
    },
    { sourceWindowId, sourceTabId, targetUrl }
  );
}

async function ensureSourceTab(serviceWorker, sourceUrl) {
  return swEval(
    serviceWorker,
    async ({ sourceUrl }) => {
      const tabs = await chrome.tabs.query({ url: sourceUrl });
      const tab =
        tabs[0] ?? (await chrome.tabs.create({ url: sourceUrl, active: true }));
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return {
        tabId: tab.id,
        windowId: tab.windowId,
      };
    },
    { sourceUrl }
  );
}

async function startContextMenuHiddenPreload(serviceWorker, { sourceTabId, targetUrl }) {
  return swEval(
    serviceWorker,
    async ({ sourceTabId, targetUrl }) => {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      queueMutation(() =>
        globalThis.ZeroLatencyPreloadInteraction.startInteractionPreload(
          {
            targetUrl,
            sourcePageUrl: sourceTab.url,
            forceNewTab: true,
            targetHint: "_blank",
            trigger: "contextmenu",
          },
          { tab: sourceTab }
        )
      );
      return { ok: true, queued: true };
    },
    { sourceTabId, targetUrl }
  );
}

async function readRoutingPrerequisites(serviceWorker) {
  return swEval(serviceWorker, async () => {
    const settings = getEffectiveExtensionSettings();
    return {
      realPreloadEnabled: settings?.preloading?.realPreloadEnabled,
      effectiveRealPreloadEnabled: settings?.preloading?.effectiveRealPreloadEnabled,
      allNative:
        globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
          settings
        ),
      hiddenRuntime: globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.(),
      hiddenStrategy: typeof supportsHiddenTabPreloadStrategy === "function"
        ? supportsHiddenTabPreloadStrategy(settings)
        : null,
      currentTabSwap: settings?.experiments?.crossSiteCurrentTabSwap,
    };
  });
}

async function createTargetWithUrl(serviceWorker, { sourceTabId, targetUrl }) {
  return swEval(
    serviceWorker,
    async ({ sourceTabId, targetUrl }) => {
      const tab = await chrome.tabs.create({
        url: targetUrl,
        openerTabId: sourceTabId,
        active: false,
      });
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        openerTabId: tab.openerTabId ?? null,
        initialUrl: tab.pendingUrl || tab.url || "",
      };
    },
    { sourceTabId, targetUrl }
  );
}

async function createBlankThenUpdateTarget(serviceWorker, { sourceTabId, targetUrl }) {
  return swEval(
    serviceWorker,
    async ({ sourceTabId, targetUrl }) => {
      const tab = await chrome.tabs.create({
        url: "about:blank",
        openerTabId: sourceTabId,
        active: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await chrome.tabs.update(tab.id, { url: targetUrl });
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        openerTabId: tab.openerTabId ?? null,
        initialUrl: tab.pendingUrl || tab.url || "",
        updatedUrl: targetUrl,
      };
    },
    { sourceTabId, targetUrl }
  );
}

async function waitForRoutedActivation(
  serviceWorker,
  { sourceWindowId, sourceTabId, createdTabId, targetUrl },
  timeoutMs = 10000
) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await swEval(
      serviceWorker,
      async ({ sourceWindowId, sourceTabId, createdTabId, targetUrl }) => {
        const tabs = await chrome.tabs.query({ windowId: sourceWindowId });
        const sourceTab = await chrome.tabs.get(sourceTabId).catch(() => null);
        const createdTab = await chrome.tabs.get(createdTabId).catch(() => null);
        const activeTarget =
          tabs.find(
            (tab) =>
              tab.active === true &&
              stripHashForSmoke(tab.url) === stripHashForSmoke(targetUrl)
          ) ?? null;
        return {
          sourceExists: Boolean(sourceTab),
          createdTabClosed: createdTab === null,
          activeTarget: Boolean(activeTarget),
          activeTargetTabId: activeTarget?.id ?? null,
          activeTargetWindowId: activeTarget?.windowId ?? null,
          activeUrl: activeTarget?.url ?? null,
          tabUrls: tabs.map((tab) => tab.url || ""),
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
      { sourceWindowId, sourceTabId, createdTabId, targetUrl }
    );

    if (
      lastState.sourceExists === true &&
      lastState.createdTabClosed === true &&
      lastState.activeTarget === true
    ) {
      return lastState;
    }

    await sleep(200);
  }

  return lastState || {
    sourceExists: false,
    createdTabClosed: false,
    activeTarget: false,
  };
}

async function getDebugEventCount(serviceWorker) {
  const events = await swEval(serviceWorker, async () =>
    globalThis.ZeroLatencyDebugEvents?.snapshot?.(500) ?? []
  );
  return Array.isArray(events) ? events.length : 0;
}

async function getRelatedDebugEvents(serviceWorker, { targetUrl, afterIndex }) {
  const events = await getDebugEventsAfter(serviceWorker, afterIndex);

  return events
    .filter(
      (event) =>
        JSON.stringify(event).includes(targetUrl) ||
        getEventName(event).includes("preload-activation")
    );
}

async function getDebugEventsAfter(serviceWorker, afterIndex) {
  const events = await swEval(serviceWorker, async () =>
    globalThis.ZeroLatencyDebugEvents?.snapshot?.(500) ?? []
  );

  return (Array.isArray(events) ? events : []).slice(
    Math.max(0, Number(afterIndex) || 0)
  );
}

function compactDebugEvents(events) {
  return (Array.isArray(events) ? events : [])
    .slice(0, 60)
    .map((event) => ({
      name: getEventName(event),
      payload: event?.payload ?? null,
    }));
}

async function waitForExtensionServiceWorker(debugPort, timeoutMs = 20000) {
  return waitForZeroLatencyExtensionServiceWorker({
    debugPort,
    timeoutMs,
    requiredPermissions: ["nativeMessaging", "tabs", "windows"],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
