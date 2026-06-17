import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, runtimeEval } from "./lib/cdp-client.mjs";
import {
  buildExtensionBrowserArgs,
  closeBrowserByDebugPort,
  spawnBrowser,
} from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getChromePathCandidates,
  getEdgePathCandidates,
  getSharedPlaywrightChromiumPathCandidates,
  getUserPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import { prepareExtensionUnderTest } from "./lib/extension-fixture.mjs";
import {
  createHostResolverRules,
  fetchJson,
  getFreePort,
  rmWithRetry,
  sleep,
} from "./lib/test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extension");
const runRoot = path.join(
  os.tmpdir(),
  `zlw-extension-load-diagnose-${process.pid}-${Date.now()}`
);

const browserGroups = [
  {
    name: "playwright-chromium-shared",
    executablePath: findFirstExistingExecutable(getSharedPlaywrightChromiumPathCandidates()),
  },
  {
    name: "playwright-chromium-user",
    executablePath: findFirstExistingExecutable(getUserPlaywrightChromiumPathCandidates()),
  },
  {
    name: "chrome-stable",
    executablePath: findFirstExistingExecutable(
      getChromePathCandidates().filter((candidate) =>
        /Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/i.test(candidate)
      )
    ),
  },
  {
    name: "edge-stable",
    executablePath: findFirstExistingExecutable(getEdgePathCandidates()),
  },
];

async function main() {
  const requested = new Set(process.argv.slice(2));
  const selectedBrowsers = browserGroups.filter(
    (browser) => requested.size === 0 || requested.has(browser.name)
  );
  const results = [];

  await mkdir(runRoot, { recursive: true });

  try {
    for (const browser of selectedBrowsers) {
      results.push(await diagnoseBrowser(browser));
    }
  } finally {
    await rmWithRetry(runRoot).catch(() => {});
  }

  console.log(JSON.stringify({ runRoot, results }, null, 2));
  if (results.some((result) => result.ok !== true)) {
    process.exitCode = 1;
  }
}

async function diagnoseBrowser(browser) {
  if (!browser.executablePath || !existsSync(browser.executablePath)) {
    return {
      name: browser.name,
      ok: false,
      phase: "missing-browser",
      executablePath: browser.executablePath || null,
    };
  }

  const profileDir = path.join(runRoot, browser.name, "profile");
  const extensionUnderTestDir = path.join(runRoot, browser.name, "extension");
  const debugPort = await getFreePort();
  const webPort = await getFreePort();
  const sourceHost = `${browser.name}.diagnose.test`;
  const startUrl = `http://${sourceHost}:${webPort}/`;
  let child = null;
  let server = null;

  try {
    await mkdir(profileDir, { recursive: true });
    await prepareExtensionUnderTest({
      extensionDir,
      targetDir: extensionUnderTestDir,
    });

    child = spawnBrowser(
      browser.executablePath,
      buildExtensionBrowserArgs({
        profileDir,
        debugPort,
        extensionDir: extensionUnderTestDir,
        resolverRules: createHostResolverRules([sourceHost]),
        startUrl,
      }),
      { windowsHide: true }
    );
    server = await startTestServer(webPort, browser.name);

    const targets = await waitForTargets(debugPort, {
      requireServiceWorker: true,
      timeoutMs: 20000,
    });
    const serviceWorkers = targets.filter(
      (target) => target.type === "service_worker" && /^chrome-extension:\/\//.test(target.url)
    );

    if (serviceWorkers.length === 0) {
      return {
        name: browser.name,
        ok: false,
        phase: "no-extension-service-worker",
        executablePath: browser.executablePath,
        targets: summarizeTargets(targets),
      };
    }

    const workerResults = [];
    for (const target of serviceWorkers) {
      workerResults.push(await diagnoseServiceWorker(target));
    }

    const matchingWorker = workerResults.find(
      (result) =>
        result.manifest?.background?.service_worker === "service-worker.js" &&
        Array.isArray(result.manifest?.permissions) &&
        result.manifest.permissions.includes("nativeMessaging")
    );

    return {
      name: browser.name,
      ok: matchingWorker?.ok === true,
      phase: matchingWorker?.ok ? "ok" : "worker-evaluate-failed",
      executablePath: browser.executablePath,
      targets: summarizeTargets(targets),
      workerResults,
    };
  } catch (error) {
    return {
      name: browser.name,
      ok: false,
      phase: "exception",
      executablePath: browser.executablePath,
      error: error?.stack || error?.message || String(error),
    };
  } finally {
    if (child) {
      await closeBrowserByDebugPort({ child, debugPort });
    }
    server?.close();
  }
}

async function waitForTargets(
  debugPort,
  { requireServiceWorker = false, timeoutMs = 15000 } = {}
) {
  const startedAt = Date.now();
  let lastError = null;
  let lastTargets = [];

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastTargets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      if (
        !requireServiceWorker ||
        lastTargets.some(
          (target) =>
            target.type === "service_worker" && /^chrome-extension:\/\//.test(target.url)
        )
      ) {
        return lastTargets;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  if (lastTargets.length > 0) {
    return lastTargets;
  }

  throw lastError || new Error("Timed out waiting for CDP targets");
}

async function diagnoseServiceWorker(target) {
  let client = null;
  const result = {
    url: target.url,
    title: target.title,
    ok: false,
    steps: [],
  };

  try {
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await runStep(result, "Runtime.enable", () => client.send("Runtime.enable"));
    result.onePlusOne = await runStep(result, "evaluate:1+1", () =>
      runtimeEval(client, "1 + 1")
    );
    result.locationHref = await runStep(result, "evaluate:location.href", () =>
      runtimeEval(client, "globalThis.location?.href || null")
    );
    result.manifest = await runStep(result, "evaluate:getManifest", () =>
      runtimeEval(client, "chrome.runtime.getManifest()")
    );
    result.hasSettings = await runStep(result, "evaluate:hasSettings", () =>
      runtimeEval(client, "typeof globalThis.ZeroLatencySettings?.cloneSettings")
    );
    if (isZeroLatencyManifest(result.manifest)) {
      result.setupProbe = await diagnoseSetupSteps(result, client);
    }
    result.ok = true;
  } catch (error) {
    result.error = error?.stack || error?.message || String(error);
  } finally {
    client?.close();
  }

  return result;
}

async function diagnoseSetupSteps(result, client) {
  const probe = {};
  probe.cloneDefaults = await runStep(result, "setup:cloneDefaults", () =>
    runtimeEval(
      client,
      `(() => {
        const settings = globalThis.ZeroLatencySettings.cloneSettings(
          globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
        );
        return {
          preloadingEnabled: settings.preloading.enabled,
          hasLayout: Boolean(settings.layout?.ruleCards?.items),
        };
      })()`
    )
  );
  probe.saveSettings = await runStep(result, "setup:saveSettings", () =>
    runtimeEval(
      client,
      `(async () => {
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
        return {
          preloadingEnabled: storedSettings.preloading.enabled,
          watchdogEnabled: storedSettings.preloadWindow.watchdogEnabled,
        };
      })()`
    )
  );
  probe.setCachedSettings = await runStep(result, "setup:setCachedSettings", () =>
    runtimeEval(
      client,
      `(async () => {
        const settings = await globalThis.ZeroLatencySettings.loadSettings(chrome.storage.local);
        globalThis.backgroundState.setCachedSettings(settings);
        return typeof globalThis.backgroundState.setCachedSettings === "function";
      })()`
    )
  );
  probe.loadServiceState = await runStep(result, "setup:loadServiceState", () =>
    runtimeEval(client, "loadServiceState()")
  );
  probe.saveServiceState = await runStep(result, "setup:saveServiceState", () =>
    runtimeEval(
      client,
      `(async () => {
        const serviceState = await loadServiceState();
        serviceState.paused = false;
        serviceState.updatedAt = new Date().toISOString();
        await saveServiceState(serviceState);
        return loadServiceState();
      })()`
    )
  );
  probe.ensureHeartbeatAlarmTrue = await runStep(result, "runtime:ensureHeartbeatAlarmTrue", () =>
    runtimeEval(
      client,
      "globalThis.ZeroLatencyNativeAppHeartbeat?.ensureAlarm?.(true) ?? null"
    )
  );
  probe.nativeHeartbeat = await runStep(result, "runtime:nativeHeartbeatSend", () =>
    runtimeEval(
      client,
      `(async () => {
        const timeout = new Promise((resolve) => {
          setTimeout(() => resolve({ ok: false, timedOut: true }), 4000);
        });
        const heartbeat = (async () => {
          try {
            return await globalThis.ZeroLatencyNativeAppHeartbeat?.send?.("diagnose") ?? null;
          } catch (error) {
            return { ok: false, error: String(error?.message || error) };
          }
        })();
        return Promise.race([heartbeat, timeout]);
      })()`
    )
  );
  probe.probeNativeApp = await runStep(result, "runtime:probeNativeAppAvailability", () =>
    runtimeEval(
      client,
      `globalThis.ZeroLatencySupport.probeNativeAppAvailability({
        forceRefresh: true
      })`
    )
  );
  probe.lmStudioWatchdog = await runStep(result, "runtime:lmStudioWatchdog", () =>
    runtimeEval(
      client,
      "globalThis.ZeroLatencyAiProviders?.ensureLmStudioLifecycleWatchdog?.(getEffectiveExtensionSettings()) ?? null"
    )
  );
  probe.ensureWarmWindows = await runStep(result, "runtime:ensureWarmWindows", () =>
    runtimeEval(
      client,
      "globalThis.ZeroLatencyPreloadRuntimeManager.ensureWarmWindows?.() ?? null"
    )
  );
  probe.maintainRuntime = await runStep(result, "runtime:maintain", () =>
    runtimeEval(client, "globalThis.ZeroLatencyPreloadRuntimeManager.maintain()")
  );
  probe.refreshOpenTabs = await runStep(result, "runtime:refreshOpenTabs", () =>
    runtimeEval(client, "requestPreloadCandidateRefreshForOpenTabs()")
  );
  probe.applyRuntimeSettings = await runStep(result, "runtime:applyRuntimeSettingsFull", () =>
    runtimeEval(
      client,
      "globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction()"
    )
  );
  probe.ensureHeartbeatAlarmFalse = await runStep(result, "setup:ensureHeartbeatAlarmFalse", () =>
    runtimeEval(
      client,
      "globalThis.ZeroLatencyNativeAppHeartbeat?.ensureAlarm?.(false) ?? null"
    )
  );
  probe.clearWakeAlarm = await runStep(result, "setup:clearWakeAlarm", () =>
    runtimeEval(
      client,
      "chrome.alarms.clear(globalThis.ZeroLatencyNativeAppHeartbeat?.wakeAlarmName)"
    )
  );
  return probe;
}

async function runStep(result, name, action) {
  const startedAt = Date.now();
  try {
    const value = await action();
    result.steps.push({ name, ok: true, elapsedMs: Date.now() - startedAt });
    return value;
  } catch (error) {
    result.steps.push({
      name,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error?.message || String(error),
    });
    throw error;
  }
}

function summarizeTargets(targets) {
  return targets.map((target) => ({
    type: target.type,
    url: target.url,
    title: target.title,
  }));
}

function isZeroLatencyManifest(manifest) {
  return (
    manifest?.background?.service_worker === "service-worker.js" &&
    Array.isArray(manifest?.permissions) &&
    manifest.permissions.includes("nativeMessaging") &&
    manifest.permissions.includes("bookmarks")
  );
}

async function startTestServer(port, browserName) {
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>ZLW diagnose ${browserName}</title></head>
  <body>
    <h1>ZLW diagnose ${browserName}</h1>
    <a href="/next">next</a>
  </body>
</html>`);
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
