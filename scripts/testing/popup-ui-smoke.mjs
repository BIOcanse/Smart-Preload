import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, runtimeEval } from "./lib/cdp-client.mjs";
import { waitForExtensionServiceWorker, waitForTarget } from "./lib/cdp-discovery.mjs";
import {
  buildExtensionBrowserArgs,
  closeBrowserByDebugPort,
  spawnBrowser,
} from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getEdgePathCandidates,
  getSharedPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import { prepareExtensionUnderTest } from "./lib/extension-fixture.mjs";
import { fetchJson, getFreePort, rmWithRetry, sleep } from "./lib/test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extansion");
const runRoot = path.join(os.tmpdir(), `zlw-popup-ui-smoke-${process.pid}-${Date.now()}`);

const browserGroups = [
  {
    name: "playwright-chromium-shared",
    executablePath: findFirstExistingExecutable(getSharedPlaywrightChromiumPathCandidates()),
  },
  {
    name: "edge-stable",
    executablePath: findFirstExistingExecutable(getEdgePathCandidates()),
  },
];

const requested = new Set(process.argv.slice(2));
const selectedBrowsers = browserGroups.filter(
  (browser) => requested.size === 0 || requested.has(browser.name)
);
const results = [];

await mkdir(runRoot, { recursive: true });

try {
  for (const browser of selectedBrowsers) {
    results.push(await smokeBrowser(browser));
  }
} finally {
  await rmWithRetry(runRoot).catch(() => {});
}

console.log(JSON.stringify({ runRoot, results }, null, 2));
if (results.some((result) => result.ok !== true)) {
  process.exitCode = 1;
}

async function smokeBrowser(browser) {
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
  let child = null;
  let browserClient = null;
  let pageClient = null;
  let workerTarget = null;

  try {
    await mkdir(profileDir, { recursive: true });
    const extensionFixture = await prepareExtensionUnderTest({
      extensionDir,
      targetDir: extensionUnderTestDir,
    });

    child = spawnBrowser(
      browser.executablePath,
      buildExtensionBrowserArgs({
        profileDir,
        debugPort,
        extensionDir: extensionUnderTestDir,
        startUrl: "about:blank",
      }),
      { windowsHide: true }
    );

    workerTarget = await waitForExtensionServiceWorker({
      debugPort,
      isTargetManifest({ manifest, permissions }) {
        return (
          manifest?.background?.service_worker === "service-worker.js" &&
          permissions.includes("nativeMessaging") &&
          permissions.includes("tabs")
        );
      },
      failureLabel: `${browser.name} Smart Preload service worker`,
    });

    const extensionId = extractExtensionId(workerTarget.url);
    assert.ok(extensionId, `Could not extract extension id from ${workerTarget.url}`);
    workerTarget.client?.close();

    browserClient = await connectBrowser(debugPort);
    const popupUrl = `chrome-extension://${extensionId}/popup/hello.html`;
    const createdTarget = await browserClient.send("Target.createTarget", {
      url: popupUrl,
    });
    const pageTarget = await waitForTarget(
      debugPort,
      (target) => target.id === createdTarget.targetId,
      10000
    );

    pageClient = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await pageClient.send("Runtime.enable");
    const snapshot = await waitForPopupSnapshot(pageClient);

    assert.equal(snapshot.hasSnapshotLoader, true);
    assert.equal(snapshot.hasServiceState, true);
    assert.equal(snapshot.hasTopTargets, true);
    assert.equal(snapshot.hasWarnings, true);
    assert.equal(snapshot.refreshButtonPresent, true);
    assert.equal(snapshot.serviceButtonPresent, true);
    assert.equal(snapshot.settingsButtonPresent, true);
    assert.doesNotMatch(snapshot.statusText, /failed|失败/iu);

    return {
      name: browser.name,
      ok: true,
      phase: "ok",
      executablePath: browser.executablePath,
      extensionId,
      extensionSourceRoot: extensionFixture.sourceRoot,
      usedPackagedExtension: extensionFixture.usedPackaged,
      snapshot,
    };
  } catch (error) {
    workerTarget?.client?.close();
    return {
      name: browser.name,
      ok: false,
      phase: "exception",
      executablePath: browser.executablePath,
      error: error?.stack || error?.message || String(error),
    };
  } finally {
    pageClient?.close();
    browserClient?.close();
    if (child) {
      await closeBrowserByDebugPort({ child, debugPort });
    }
  }
}

async function connectBrowser(debugPort) {
  const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
  if (!version?.webSocketDebuggerUrl) {
    throw new Error("Browser CDP websocket URL is unavailable");
  }
  return CdpClient.connect(version.webSocketDebuggerUrl);
}

async function waitForPopupSnapshot(pageClient) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  let lastError = null;

  while (Date.now() - startedAt < 12000) {
    try {
      const snapshotJson = await runtimeEval(
        pageClient,
        `JSON.stringify((() => ({
          href: location.href,
          readyState: document.readyState,
          hasSnapshotLoader:
            typeof globalThis.ZeroLatencyPopupSnapshotLoader?.create === "function",
          hasServiceState:
            typeof globalThis.ZeroLatencyPopupServiceState?.create === "function",
          hasTopTargets: typeof globalThis.ZeroLatencyPopupTopTargets?.render === "function",
          hasWarnings: typeof globalThis.ZeroLatencyPopupWarnings?.create === "function",
          refreshButtonPresent: Boolean(document.getElementById("refresh-button")),
          serviceButtonPresent: Boolean(document.getElementById("service-toggle-button")),
          settingsButtonPresent: Boolean(document.getElementById("settings-button")),
          statusText: document.getElementById("status-text")?.textContent?.trim() || "",
          nodeCountText: document.getElementById("node-count")?.textContent?.trim() || "",
          edgeCountText: document.getElementById("edge-count")?.textContent?.trim() || "",
        }))())`
      );
      lastSnapshot = JSON.parse(snapshotJson || "{}");

      if (
        lastSnapshot.readyState === "complete" &&
        lastSnapshot.hasSnapshotLoader &&
        lastSnapshot.hasServiceState &&
        lastSnapshot.hasTopTargets &&
        lastSnapshot.hasWarnings &&
        lastSnapshot.refreshButtonPresent &&
        lastSnapshot.serviceButtonPresent &&
        lastSnapshot.settingsButtonPresent &&
        lastSnapshot.statusText &&
        !/loading|waiting|正在|等待/iu.test(lastSnapshot.statusText)
      ) {
        return lastSnapshot;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Popup page did not initialize. Last snapshot: ${JSON.stringify(
      lastSnapshot,
      null,
      2
    )}; last error: ${lastError?.stack || lastError?.message || ""}`
  );
}

function extractExtensionId(url) {
  const match = /^chrome-extension:\/\/([^/]+)\//u.exec(String(url || ""));
  return match?.[1] || "";
}
