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
const extensionDir = path.join(repoRoot, "extension");
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
  const argumentsList = process.argv.slice(2);
  const preferPackaged = !argumentsList.includes("--source");
  const requested = new Set(argumentsList.filter((argument) => argument !== "--source"));
  const selectedBrowsers = browserGroups.filter(
    (browser) => requested.size === 0 || requested.has(browser.name)
  );
  const results = [];

  await mkdir(runRoot, { recursive: true });

  try {
    for (const browser of selectedBrowsers) {
      results.push(await smokeBrowser(browser, { preferPackaged }));
    }
  } finally {
    await rmWithRetry(runRoot).catch(() => {});
  }

  console.log(JSON.stringify({ runRoot, results }, null, 2));
  if (results.some((result) => result.ok !== true)) {
    process.exitCode = 1;
  }
}

async function smokeBrowser(browser, { preferPackaged = true } = {}) {
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
      preferPackaged,
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
    assert.equal(snapshot.mobilePlatform, false);
    assert.equal(snapshot.realPreloadVisible, true);
    assert.ok(snapshot.ruleCardCount >= 1, "settings rule cards did not render");
    assert.ok(snapshot.helpIconCount >= 1, "settings help icons did not render");
    assert.ok(snapshot.navButtonCount >= 3, "settings nav did not render");
    assert.equal(snapshot.historyDeleteButtonPresent, true);
    assert.equal(snapshot.historyImportButtonPresent, true);
    assert.equal(snapshot.historyExportButtonPresent, true);
    assert.equal(snapshot.hasHistoryTransferController, true);
    assert.equal(snapshot.saveFilePickerAvailable, true);
    assert.equal(snapshot.openFilePickerAvailable, true);
    assert.ok(snapshot.historyTransferHelpText.length > 20);
    assert.match(snapshot.historyUtcText, /UTC$/u);
    assert.equal(snapshot.historyNativeDateInputCount, 0);
    assert.equal(snapshot.historyDatePartInputCount, 6);
    assert.equal(snapshot.excludeHttpPagesPresent, true);
    assert.equal(snapshot.excludeHttpPagesChecked, true);
    assert.equal(snapshot.skipSensitivePagesPresent, true);
    assert.equal(snapshot.skipSensitivePagesChecked, true);
    assert.match(
      snapshot.aiModelSelectionAdviceText,
      /fast|快速|快|schnell|rápido|rapide|rápido|быстр|高速|빠르/u
    );
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
    assert.equal(snapshot.aiModelListModePresent, true);
    assert.equal(snapshot.aiModelListModeValue, "recommended");
    assert.ok(snapshot.aiModelListModeOptionCount >= 2, "AI model list mode options did not render");
    const historyRuntimeProbe = await probeHistoryTransferRuntime(pageClient);
    const historyRuntimeContext = JSON.stringify(historyRuntimeProbe);
    assert.equal(historyRuntimeProbe.exportOk, true, historyRuntimeContext);
    assert.equal(historyRuntimeProbe.format, "smart-preload-history");
    assert.equal(historyRuntimeProbe.formatVersion, 1);
    assert.equal(historyRuntimeProbe.validateOk, true, historyRuntimeContext);
    assert.equal(historyRuntimeProbe.importOk, true, historyRuntimeContext);
    const historyExportDialogProbe = await probeHistoryExportWarningDialog(pageClient);
    assert.equal(historyExportDialogProbe.opened, true);
    assert.equal(historyExportDialogProbe.removedAfterCancel, true);
    assert.ok(historyExportDialogProbe.title.length > 5);
    assert.ok(historyExportDialogProbe.message.length > 20);
    assert.match(historyExportDialogProbe.message, /请勿随意分享该文件/u);
    assert.match(historyExportDialogProbe.message, /隐私泄露.*概不负责/u);
    const dialogProbe = await probeRealPreloadRiskDialog(pageClient);
    assert.equal(dialogProbe.opened, true);
    assert.equal(dialogProbe.confirmed, false);
    assert.equal(dialogProbe.removedAfterCancel, true);
    assert.match(dialogProbe.title, /Real Preload|真实预加载|真實預載/u);
    const advancedDialogProbe = await probeRealPreloadAdvancedRiskDialog(pageClient);
    const advancedDialogContext = JSON.stringify(advancedDialogProbe);
    assert.equal(advancedDialogProbe.confirmed, true, advancedDialogContext);
    assert.equal(advancedDialogProbe.typedDialogOpened, true, advancedDialogContext);
    assert.equal(
      advancedDialogProbe.confirmDisabledBeforeTyping,
      true,
      advancedDialogContext
    );
    assert.equal(advancedDialogProbe.disclaimerOpened, true, advancedDialogContext);
    assert.equal(advancedDialogProbe.acknowledged, true, advancedDialogContext);
    assert.equal(advancedDialogProbe.removedAfterConfirm, true, advancedDialogContext);
    const toggleProbe = await probeRealPreloadRiskToggle(pageClient);
    assert.equal(toggleProbe.dialogOpened, true);
    assert.equal(toggleProbe.checkedAfterCancel, false);
    const successfulToggleProbe = await probeRealPreloadRiskToggleSuccess(pageClient);
    const successfulToggleContext = JSON.stringify(successfulToggleProbe);
    assert.equal(successfulToggleProbe.dialogCount, 3, successfulToggleContext);
    assert.equal(successfulToggleProbe.checkedAfterConfirm, true, successfulToggleContext);
    assert.equal(successfulToggleProbe.savedRealPreloadEnabled, true, successfulToggleContext);
    assert.equal(successfulToggleProbe.savedRiskAcknowledged, true, successfulToggleContext);
    assert.equal(successfulToggleProbe.duplicateDialogOpened, false, successfulToggleContext);
    const mobileSnapshot = await probeMobileSettingsPage({
      browserClient,
      debugPort,
      settingsUrl,
    });
    const mobileSnapshotContext = JSON.stringify(mobileSnapshot);
    assert.equal(mobileSnapshot.mobilePlatform, true, mobileSnapshotContext);
    assert.ok(mobileSnapshot.desktopOnlyCount >= 10, mobileSnapshotContext);
    assert.equal(mobileSnapshot.desktopOnlyVisibleCount, 0, mobileSnapshotContext);
    assert.equal(mobileSnapshot.realPreloadVisible, false, mobileSnapshotContext);
    assert.equal(mobileSnapshot.desktopRuleCardCount, 2, mobileSnapshotContext);
    assert.equal(mobileSnapshot.desktopRuleCardVisibleCount, 0, mobileSnapshotContext);
    assert.equal(mobileSnapshot.nativePreloadVisible, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.interactionPreloadVisible, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.nativeSchedulerVisible, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.attentionSchedulerVisible, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.easterEggPresent, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.easterEggVisible, false, mobileSnapshotContext);
    assert.ok(mobileSnapshot.easterEggText.length > 20, mobileSnapshotContext);
    assert.equal(mobileSnapshot.helpTooltipWithinViewport, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.easterEggRevealVisible, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.footerReady, true, mobileSnapshotContext);
    assert.equal(mobileSnapshot.hasHorizontalOverflow, false, mobileSnapshotContext);

    return {
      name: browser.name,
      ok: true,
      phase: "ok",
      executablePath: browser.executablePath,
      extensionId,
      extensionSourceRoot: extensionFixture.sourceRoot,
      usedPackagedExtension: extensionFixture.usedPackaged,
      snapshot,
      mobileSnapshot,
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

async function probeMobileSettingsPage({ browserClient, debugPort, settingsUrl }) {
  const mobileUserAgent =
    "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  let targetId = null;
  let mobilePageClient = null;

  try {
    const createdTarget = await browserClient.send("Target.createTarget", {
      url: "about:blank",
    });
    targetId = createdTarget.targetId;
    const pageTarget = await waitForTarget(
      debugPort,
      (target) => target.id === targetId,
      10000
    );

    mobilePageClient = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await mobilePageClient.send("Runtime.enable");
    await mobilePageClient.send("Page.enable");
    await mobilePageClient.send("Emulation.setUserAgentOverride", {
      userAgent: mobileUserAgent,
      platform: "Android",
    });
    await mobilePageClient.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await mobilePageClient.send("Page.navigate", { url: settingsUrl });

    const snapshot = await waitForMobileSettingsPageSnapshot(mobilePageClient);
    const interactionSnapshot = await probeMobileSettingsInteractions(mobilePageClient);
    return {
      ...snapshot,
      ...interactionSnapshot,
    };
  } finally {
    mobilePageClient?.close();
    if (targetId) {
      await browserClient.send("Target.closeTarget", { targetId }).catch(() => {});
    }
  }
}

async function probeMobileSettingsInteractions(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const waitForPaint = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
      const isVisible = (element) =>
        Boolean(
          element &&
            getComputedStyle(element).display !== "none" &&
            element.getClientRects().length > 0
        );
      const help = [...document.querySelectorAll(".settings-help")].find(
        (element) => element.getClientRects().length > 0
      );
      const tooltip = help?.querySelector(".settings-help-tooltip");
      const tooltipRect = tooltip?.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const helpTooltipWithinViewport = Boolean(
        tooltipRect &&
          tooltipRect.left >= -1 &&
          tooltipRect.right <= viewportWidth + 1 &&
          tooltipRect.top >= -1 &&
          tooltipRect.bottom <= viewportHeight + 1
      );

      const realPreloadRow = document
        .getElementById("real-preload-enabled")
        ?.closest("[data-desktop-real-preload-only]");
      const easterEgg = realPreloadRow?.querySelector(".mobile-platform-easter-egg");
      realPreloadRow?.removeAttribute("data-desktop-real-preload-only");
      await waitForPaint();
      const easterEggRevealVisible = isVisible(easterEgg);
      realPreloadRow?.setAttribute("data-desktop-real-preload-only", "");

      return {
        helpTooltipWithinViewport,
        easterEggRevealVisible,
      };
    })()))()`,
    { timeoutMs: 10000 }
  );
  return JSON.parse(resultJson || "{}");
}

async function waitForMobileSettingsPageSnapshot(pageClient) {
  const startedAt = Date.now();
  let lastSnapshot = null;
  let lastError = null;

  while (Date.now() - startedAt < 12000) {
    try {
      const snapshotJson = await runtimeEval(
        pageClient,
        `JSON.stringify((() => {
          const isVisible = (element) =>
            Boolean(
              element &&
                getComputedStyle(element).display !== "none" &&
                element.getClientRects().length > 0
            );
          const desktopOnlyElements = [
            ...document.querySelectorAll("[data-desktop-real-preload-only]"),
          ];
          const desktopRuleCards = [
            ...document.querySelectorAll(
              '.rule-card[data-card-id="perPagePreloadLimit"], ' +
                '.rule-card[data-card-id="highWeightRankTab"]'
            ),
          ];
          const footerTitle =
            document.getElementById("footer-status-title")?.textContent?.trim() || "";
          const readyText =
            globalThis.ZeroLatencyI18n?.t?.("commonReady", [], "Ready") || "Ready";
          const realPreload = document.getElementById("real-preload-enabled");
          const nativePreload = document.getElementById("preloading-enabled");
          const interactionPreload = document.getElementById("interaction-preload-enabled");
          const nativeScheduler = document
            .getElementById("scheduler-native-total-max")
            ?.closest("fieldset");
          const attentionScheduler = document
            .getElementById("scheduler-attention-pool-enabled")
            ?.closest("fieldset");
          const easterEgg = document.querySelector(".mobile-platform-easter-egg");
          const scrollingElement = document.scrollingElement || document.documentElement;
          const viewportWidth = document.documentElement.clientWidth;
          const overflowingElements = [...document.querySelectorAll("body *")]
            .filter((element) => element.getBoundingClientRect().right > viewportWidth + 1)
            .sort(
              (left, right) =>
                right.getBoundingClientRect().right - left.getBoundingClientRect().right
            )
            .slice(0, 16)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                id: element.id || "",
                className: String(element.className || ""),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                i18n: element.getAttribute("data-i18n") || "",
                text: element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 80) || "",
              };
            });

          return {
            readyState: document.readyState,
            hasSettingsApi:
              typeof globalThis.ZeroLatencySettings?.cloneSettings === "function",
            ruleCardCount: document.querySelectorAll(".rule-card").length,
            mobilePlatform:
              document.documentElement.dataset.mobilePlatform === "true",
            desktopOnlyCount: desktopOnlyElements.length,
            desktopOnlyVisibleCount: desktopOnlyElements.filter(isVisible).length,
            realPreloadVisible: isVisible(
              realPreload?.closest("[data-desktop-real-preload-only]")
            ),
            desktopRuleCardCount: desktopRuleCards.length,
            desktopRuleCardVisibleCount: desktopRuleCards.filter(isVisible).length,
            nativePreloadVisible: isVisible(nativePreload?.closest(".settings-item")),
            interactionPreloadVisible: isVisible(
              interactionPreload?.closest(".settings-item")
            ),
            nativeSchedulerVisible: isVisible(nativeScheduler),
            attentionSchedulerVisible: isVisible(attentionScheduler),
            easterEggPresent: Boolean(easterEgg),
            easterEggVisible: isVisible(easterEgg),
            easterEggText: easterEgg?.textContent?.trim() || "",
            footerReady: footerTitle === readyText,
            footerTitle,
            hasHorizontalOverflow:
              scrollingElement.scrollWidth > viewportWidth + 1,
            viewportWidth,
            contentWidth: scrollingElement.scrollWidth,
            overflowingElements,
          };
        })())`
      );
      lastSnapshot = JSON.parse(snapshotJson || "{}");

      if (
        lastSnapshot.readyState === "complete" &&
        lastSnapshot.hasSettingsApi &&
        lastSnapshot.ruleCardCount >= 1 &&
        lastSnapshot.mobilePlatform &&
        lastSnapshot.desktopOnlyCount >= 10 &&
        lastSnapshot.desktopRuleCardCount === 2 &&
        lastSnapshot.easterEggPresent &&
        lastSnapshot.footerReady
      ) {
        return lastSnapshot;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw new Error(
    `Mobile settings page did not initialize. Last snapshot: ${JSON.stringify(
      lastSnapshot,
      null,
      2
    )}; last error: ${lastError?.stack || lastError?.message || ""}`
  );
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
          hasHistoryTransferController:
            typeof globalThis.ZeroLatencySettingsHistoryTransferController?.create === "function",
          mobilePlatform:
            document.documentElement.dataset.mobilePlatform === "true",
          saveFilePickerAvailable: typeof globalThis.showSaveFilePicker === "function",
          openFilePickerAvailable: typeof globalThis.showOpenFilePicker === "function",
          navButtonCount: document.querySelectorAll(".settings-nav-item").length,
          ruleCardCount: document.querySelectorAll(".rule-card").length,
          helpIconCount: document.querySelectorAll(".settings-help").length,
          footerTitle: document.getElementById("footer-status-title")?.textContent?.trim() || "",
          footerText: document.getElementById("footer-status-text")?.textContent?.trim() || "",
          preloadTogglePresent: Boolean(document.getElementById("preloading-enabled")),
          realPreloadTogglePresent: Boolean(document.getElementById("real-preload-enabled")),
          realPreloadVisible:
            document
              .getElementById("real-preload-enabled")
              ?.closest("[data-desktop-real-preload-only]")
              ?.getClientRects().length > 0,
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
          aiModelListModePresent: Boolean(document.getElementById("ai-model-list-mode")),
          aiModelListModeValue:
            document.getElementById("ai-model-list-mode")?.value || "",
          aiModelListModeOptionCount:
            document.getElementById("ai-model-list-mode")?.options?.length || 0,
          aiModelSelectPresent: Boolean(document.getElementById("ai-prediction-model")),
          aiModelSelectionAdviceText:
            document.querySelector("[data-i18n='settingsAiModelSelectionAdvice']")?.textContent?.trim() || "",
          historyDeleteButtonPresent: Boolean(document.getElementById("history-delete-button")),
          historyImportButtonPresent: Boolean(document.getElementById("history-import-button")),
          historyExportButtonPresent: Boolean(document.getElementById("history-export-button")),
          historyTransferHelpText:
            document.querySelector(".history-transfer-item .settings-help-tooltip")?.textContent?.trim() || "",
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
        lastSnapshot.hasHistoryTransferController &&
        lastSnapshot.mobilePlatform === false &&
        lastSnapshot.realPreloadVisible &&
        lastSnapshot.saveFilePickerAvailable &&
        lastSnapshot.openFilePickerAvailable &&
        lastSnapshot.ruleCardCount >= 1 &&
        lastSnapshot.helpIconCount >= 1 &&
        lastSnapshot.historyDeleteButtonPresent &&
        lastSnapshot.historyImportButtonPresent &&
        lastSnapshot.historyExportButtonPresent &&
        lastSnapshot.historyTransferHelpText.length > 20 &&
        lastSnapshot.excludeHttpPagesPresent &&
        lastSnapshot.excludeHttpPagesChecked &&
        lastSnapshot.skipSensitivePagesPresent &&
        lastSnapshot.skipSensitivePagesChecked &&
        /fast|快速|快|schnell|rápido|rapide|rápido|быстр|高速|빠르/u.test(
          lastSnapshot.aiModelSelectionAdviceText
        ) &&
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
        lastSnapshot.aiModelListModePresent &&
        lastSnapshot.aiModelListModeValue === "recommended" &&
        lastSnapshot.aiModelListModeOptionCount >= 2 &&
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

async function probeHistoryTransferRuntime(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const exported = await chrome.runtime.sendMessage({
        type: "visit-graph:export-history",
      });
      const backupText = JSON.stringify(exported?.backup || null);
      const validation = await chrome.runtime.sendMessage({
        type: "visit-graph:validate-history-import",
        backup: backupText,
      });
      const imported = await chrome.runtime.sendMessage({
        type: "visit-graph:import-history",
        backup: backupText,
      });

      return {
        exportOk: exported?.ok === true,
        exportError: exported?.error || "",
        format: exported?.backup?.format || "",
        formatVersion: exported?.backup?.formatVersion || 0,
        validateOk: validation?.ok === true,
        validateError: validation?.error || "",
        importOk: imported?.ok === true,
        importError: imported?.error || "",
      };
    })()))()`,
    { timeoutMs: 15000 }
  );
  return JSON.parse(resultJson || "{}");
}

async function probeHistoryExportWarningDialog(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      document.getElementById("history-export-button")?.click();

      const startedAt = Date.now();
      let dialog = null;
      while (Date.now() - startedAt < 3000) {
        dialog = document.querySelector(".settings-dialog");
        if (dialog) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const title = dialog?.querySelector(".settings-dialog-title")?.textContent?.trim() || "";
      const message = dialog?.querySelector(".settings-dialog-body")?.textContent?.trim() || "";
      dialog?.querySelector(".settings-dialog-actions button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));

      return {
        opened: Boolean(dialog),
        title,
        message,
        removedAfterCancel: !document.querySelector(".settings-dialog"),
      };
    })()))()`,
    { timeoutMs: 10000 }
  );
  return JSON.parse(resultJson || "{}");
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
      await new Promise((resolve) => setTimeout(resolve, 50));

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
      await new Promise((resolve) => setTimeout(resolve, 50));
      const dialog = document.querySelector(".settings-dialog");
      const title = dialog?.querySelector(".settings-dialog-title")?.textContent?.trim() || "";
      const cancel = dialog?.querySelector(".settings-dialog-actions button");
      cancel?.click();
      const confirmed = await promise;
      await new Promise((resolve) => setTimeout(resolve, 50));
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

async function probeRealPreloadAdvancedRiskDialog(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const controller = globalThis.ZeroLatencySettingsDialogs.create({
        translate: (_key, _substitutions, fallback) => fallback,
        settingsApi: globalThis.ZeroLatencySettings,
      });
      const draftSettings = {
        preloading: {
          realPreloadEnabled: true,
          realPreloadRiskAcknowledged: false,
        },
      };
      const promise = controller.confirmRealPreloadEnableIfNeeded(
        {
          preloading: {
            realPreloadEnabled: false,
            realPreloadRiskAcknowledged: false,
          },
        },
        draftSettings
      );

      const firstDialog = await waitForSettingsDialog();
      firstDialog?.querySelector(".settings-dialog-actions button:last-child")?.click();

      const typedDialog = await waitForSettingsDialog();
      const expectedText =
        typedDialog?.querySelector(".settings-dialog-expected-text")?.textContent || "";
      const input = typedDialog?.querySelector(".settings-dialog-text-input");
      const typedConfirm = typedDialog?.querySelector(".settings-dialog-actions button:last-child");
      const confirmDisabledBeforeTyping = typedConfirm?.disabled === true;
      if (input) {
        input.value = expectedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      typedConfirm?.click();

      const disclaimerDialog = await waitForSettingsDialog();
      const disclaimerTitle =
        disclaimerDialog?.querySelector(".settings-dialog-title")?.textContent?.trim() || "";
      disclaimerDialog?.querySelector(".settings-dialog-actions button:last-child")?.click();

      const confirmed = await promise;
      await new Promise((resolve) => setTimeout(resolve, 50));

      return {
        confirmed,
        typedDialogOpened: Boolean(typedDialog),
        confirmDisabledBeforeTyping,
        disclaimerOpened: Boolean(disclaimerDialog),
        disclaimerTitle,
        acknowledged: draftSettings.preloading.realPreloadRiskAcknowledged === true,
        removedAfterConfirm: !document.querySelector(".settings-dialog"),
      };

      async function waitForSettingsDialog() {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 3000) {
          const dialog = document.querySelector(".settings-dialog");
          if (dialog) {
            return dialog;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return null;
      }
    })()))()`,
    { timeoutMs: 15000 }
  );
  return JSON.parse(resultJson || "{}");
}

async function probeRealPreloadRiskToggleSuccess(pageClient) {
  const resultJson = await runtimeEval(
    pageClient,
    `(async () => JSON.stringify(await (async () => {
      const checkbox = document.getElementById("real-preload-enabled");
      const saveButton = document.getElementById("save-button");
      if (!checkbox || !saveButton) {
        return { dialogCount: 0, missingControls: true };
      }

      let dialogCount = 0;
      checkbox.checked = false;
      checkbox.click();

      const riskDialog = await waitForNewDialog();
      dialogCount += Boolean(riskDialog) ? 1 : 0;
      riskDialog?.querySelector(".settings-dialog-actions button:last-child")?.click();

      const typedDialog = await waitForNewDialog(riskDialog);
      dialogCount += Boolean(typedDialog) ? 1 : 0;
      const expectedText =
        typedDialog?.querySelector(".settings-dialog-expected-text")?.textContent || "";
      const input = typedDialog?.querySelector(".settings-dialog-text-input");
      if (input) {
        input.value = expectedText;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      typedDialog?.querySelector(".settings-dialog-actions button:last-child")?.click();

      const disclaimerDialog = await waitForNewDialog(typedDialog);
      dialogCount += Boolean(disclaimerDialog) ? 1 : 0;
      disclaimerDialog?.querySelector(".settings-dialog-actions button:last-child")?.click();

      await waitForNoDialog();
      const checkedAfterConfirm = checkbox.checked === true;
      saveButton.click();

      const savedSettings = await waitForSavedSettings();
      await new Promise((resolve) => setTimeout(resolve, 600));

      return {
        dialogCount,
        checkedAfterConfirm,
        savedRealPreloadEnabled:
          savedSettings?.preloading?.realPreloadEnabled === true,
        savedRiskAcknowledged:
          savedSettings?.preloading?.realPreloadRiskAcknowledged === true,
        duplicateDialogOpened: Boolean(document.querySelector(".settings-dialog")),
      };

      async function waitForNewDialog(previousDialog = null) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
          const dialog = document.querySelector(".settings-dialog");
          if (dialog && dialog !== previousDialog) {
            return dialog;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return null;
      }

      async function waitForNoDialog() {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 4000) {
          if (!document.querySelector(".settings-dialog")) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      async function waitForSavedSettings() {
        const startedAt = Date.now();
        let settings = null;
        while (Date.now() - startedAt < 5000) {
          settings = await globalThis.ZeroLatencySettings.loadSettings(chrome.storage.local);
          if (
            settings?.preloading?.realPreloadEnabled === true &&
            settings?.preloading?.realPreloadRiskAcknowledged === true
          ) {
            return settings;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return settings;
      }
    })()))()`,
    { timeoutMs: 20000 }
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
