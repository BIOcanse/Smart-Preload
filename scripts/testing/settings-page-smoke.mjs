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
const runRoot = path.join(
  os.tmpdir(),
  `zlw-settings-page-smoke-${process.pid}-${Date.now()}`
);

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

async function main() {
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
  let workerTarget = null;
  let browserClient = null;
  let pageClient = null;

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
          permissions.includes("bookmarks")
        );
      },
      failureLabel: `${browser.name} Smart Preload service worker`,
    });

    const extensionId = extractExtensionId(workerTarget.url);
    assert.ok(extensionId, `Could not extract extension id from ${workerTarget.url}`);
    workerTarget.client?.close();

    browserClient = await connectBrowser(debugPort);
    const settingsUrl = `chrome-extension://${extensionId}/settings/index.html`;
    const createdTarget = await browserClient.send("Target.createTarget", {
      url: settingsUrl,
    });
    const pageTarget = await waitForTarget(
      debugPort,
      (target) => target.id === createdTarget.targetId,
      10000
    );

    pageClient = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await pageClient.send("Runtime.enable");
    const snapshot = await waitForSettingsPageSnapshot(pageClient);

    assert.equal(snapshot.hasSettingsUi, true);
    assert.equal(snapshot.hasSettingsDialogs, true);
    assert.equal(snapshot.hasTaskClient, true);
    assert.equal(snapshot.hasRuleCardsApi, true);
    assert.equal(snapshot.hasSettingsApi, true);
    assert.ok(snapshot.ruleCardCount >= 1, "settings rule cards did not render");
    assert.ok(snapshot.helpIconCount >= 1, "settings help icons did not render");
    assert.ok(snapshot.navButtonCount >= 3, "settings nav did not render");
    assert.equal(snapshot.historyDeleteButtonPresent, true);
    assert.match(snapshot.historyUtcText, /UTC$/u);
    assert.equal(snapshot.historyNativeDateInputCount, 0);
    assert.equal(snapshot.historyDatePartInputCount, 6);
    assert.equal(snapshot.excludeHttpPagesPresent, true);
    assert.equal(snapshot.excludeHttpPagesChecked, true);
    assert.equal(snapshot.skipSensitivePagesPresent, true);
    assert.equal(snapshot.skipSensitivePagesChecked, true);
    assert.match(
      snapshot.realPreloadSensitiveWarningText,
      /exam|考试|考試|Prüfung|examen|exámenes|prova|экзамен|試験|시험/u
    );
    assert.equal(snapshot.sideEffectSafetyGuardPresent, true);
    assert.equal(snapshot.sideEffectSafetyGuardChecked, true);
    assert.equal(snapshot.sideEffectSafetyGuardDisabled, true);
    assert.equal(snapshot.dangerousSiteSafetyGuardPresent, true);
    assert.equal(snapshot.dangerousSiteSafetyGuardChecked, true);
    assert.equal(snapshot.dangerousSiteSafetyGuardDisabled, true);
    assert.ok(snapshot.aiProviderOptionCount >= 1, "AI provider options did not render");
    assert.equal(snapshot.aiModelSelectPresent, true);
    const dialogProbe = await probeRealPreloadRiskDialog(pageClient);
    assert.equal(dialogProbe.opened, true);
    assert.equal(dialogProbe.confirmed, false);
    assert.equal(dialogProbe.removedAfterCancel, true);
    assert.match(dialogProbe.title, /Real Preload|真实预加载|真實預載/u);
    const toggleProbe = await probeRealPreloadRiskToggle(pageClient);
    assert.equal(toggleProbe.dialogOpened, true);
    assert.equal(toggleProbe.checkedAfterCancel, false);

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

async function waitForSettingsPageSnapshot(pageClient) {
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
          title: document.title,
          hasSettingsApi: typeof globalThis.ZeroLatencySettings?.cloneSettings === "function",
          hasSettingsUi:
            typeof globalThis.ZeroLatencySettingsUi?.compactInlineSettingDescriptions === "function",
          hasSettingsDialogs:
            typeof globalThis.ZeroLatencySettingsDialogs?.create === "function",
          hasTaskClient:
            typeof globalThis.ZeroLatencySettingsTaskClient?.waitForTask === "function",
          hasRuleCardsApi:
            typeof globalThis.ZeroLatencySettingsRuleCards?.renderRuleCardList === "function",
          navButtonCount: document.querySelectorAll(".settings-nav-item").length,
          ruleCardCount: document.querySelectorAll(".rule-card").length,
          helpIconCount: document.querySelectorAll(".settings-help").length,
          footerTitle: document.getElementById("footer-status-title")?.textContent?.trim() || "",
          footerText: document.getElementById("footer-status-text")?.textContent?.trim() || "",
          preloadTogglePresent: Boolean(document.getElementById("preloading-enabled")),
          realPreloadTogglePresent: Boolean(document.getElementById("real-preload-enabled")),
          skipSensitivePagesPresent: Boolean(document.getElementById("skip-sensitive-pages")),
          skipSensitivePagesChecked:
            document.getElementById("skip-sensitive-pages")?.checked === true,
          realPreloadSensitiveWarningText:
            document.querySelector("[data-i18n='settingsRealPreloadSensitiveSceneWarning']")?.textContent?.trim() || "",
          excludeHttpPagesPresent: Boolean(document.getElementById("exclude-http-pages")),
          excludeHttpPagesChecked:
            document.getElementById("exclude-http-pages")?.checked === true,
          sideEffectSafetyGuardPresent:
            Boolean(document.getElementById("side-effect-link-safety-guard")),
          sideEffectSafetyGuardChecked:
            document.getElementById("side-effect-link-safety-guard")?.checked === true,
          sideEffectSafetyGuardDisabled:
            document.getElementById("side-effect-link-safety-guard")?.disabled === true,
          dangerousSiteSafetyGuardPresent:
            Boolean(document.getElementById("dangerous-site-safety-guard")),
          dangerousSiteSafetyGuardChecked:
            document.getElementById("dangerous-site-safety-guard")?.checked === true,
          dangerousSiteSafetyGuardDisabled:
            document.getElementById("dangerous-site-safety-guard")?.disabled === true,
          languageOptionCount: document.getElementById("language-mode")?.options?.length || 0,
          aiProviderOptionCount:
            document.getElementById("ai-prediction-provider")?.options?.length || 0,
          aiModelSelectPresent: Boolean(document.getElementById("ai-prediction-model")),
          historyDeleteButtonPresent: Boolean(document.getElementById("history-delete-button")),
          historyUtcText:
            document.getElementById("history-delete-current-utc")?.textContent?.trim() || "",
          historyNativeDateInputCount:
            document.querySelectorAll(".history-delete-control input[type='date']").length,
          historyDatePartInputCount:
            document.querySelectorAll(".history-delete-control .history-date-input").length,
        }))())`
      );
      lastSnapshot = JSON.parse(snapshotJson || "{}");

      if (
        lastSnapshot.readyState === "complete" &&
        lastSnapshot.hasSettingsApi &&
        lastSnapshot.hasSettingsUi &&
        lastSnapshot.hasSettingsDialogs &&
        lastSnapshot.hasTaskClient &&
        lastSnapshot.hasRuleCardsApi &&
        lastSnapshot.ruleCardCount >= 1 &&
        lastSnapshot.helpIconCount >= 1 &&
        lastSnapshot.historyDeleteButtonPresent &&
        lastSnapshot.excludeHttpPagesPresent &&
        lastSnapshot.excludeHttpPagesChecked &&
        lastSnapshot.skipSensitivePagesPresent &&
        lastSnapshot.skipSensitivePagesChecked &&
        /exam|考试|考試|Prüfung|examen|exámenes|prova|экзамен|試験|시험/u.test(
          lastSnapshot.realPreloadSensitiveWarningText
        ) &&
        lastSnapshot.sideEffectSafetyGuardPresent &&
        lastSnapshot.sideEffectSafetyGuardChecked &&
        lastSnapshot.sideEffectSafetyGuardDisabled &&
        lastSnapshot.dangerousSiteSafetyGuardPresent &&
        lastSnapshot.dangerousSiteSafetyGuardChecked &&
        lastSnapshot.dangerousSiteSafetyGuardDisabled &&
        lastSnapshot.aiProviderOptionCount >= 1 &&
        lastSnapshot.aiModelSelectPresent &&
        lastSnapshot.historyNativeDateInputCount === 0 &&
        lastSnapshot.historyDatePartInputCount === 6 &&
        /UTC$/u.test(lastSnapshot.historyUtcText)
      ) {
        return lastSnapshot;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Settings page did not initialize. Last snapshot: ${JSON.stringify(
      lastSnapshot,
      null,
      2
    )}; last error: ${lastError?.stack || lastError?.message || ""}`
  );
}

async function probeRealPreloadRiskToggle(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const checkbox = document.getElementById("real-preload-enabled");
      if (!checkbox) {
        return { dialogOpened: false, checkedAfterCancel: null };
      }
      checkbox.checked = false;
      checkbox.click();

      const startedAt = Date.now();
      let dialog = null;
      while (Date.now() - startedAt < 3000) {
        dialog = document.querySelector(".settings-dialog");
        if (dialog) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const cancel = dialog?.querySelector(".settings-dialog-actions button");
      cancel?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));

      return {
        dialogOpened: Boolean(dialog),
        checkedAfterCancel: document.getElementById("real-preload-enabled")?.checked === true,
      };
    })()))()`,
    { timeoutMs: 10000 }
  );
  return JSON.parse(resultJson || "{}");
}

async function probeRealPreloadRiskDialog(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const controller = globalThis.ZeroLatencySettingsDialogs.create({
        translate: (_key, _substitutions, fallback) => fallback,
        settingsApi: globalThis.ZeroLatencySettings,
      });
      const promise = controller.confirmRealPreloadEnableIfNeeded(
        { preloading: { realPreloadEnabled: false } },
        { preloading: { realPreloadEnabled: true } }
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const dialog = document.querySelector(".settings-dialog");
      const title = dialog?.querySelector(".settings-dialog-title")?.textContent?.trim() || "";
      const cancel = dialog?.querySelector(".settings-dialog-actions button");
      cancel?.click();
      const confirmed = await promise;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return {
        opened: Boolean(dialog),
        title,
        confirmed,
        removedAfterCancel: !document.querySelector(".settings-dialog"),
      };
    })()))()`,
    { timeoutMs: 10000 }
  );
  return JSON.parse(resultJson || "{}");
}

function extractExtensionId(url) {
  const match = /^chrome-extension:\/\/([^/]+)\//u.exec(String(url || ""));
  return match?.[1] || "";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
