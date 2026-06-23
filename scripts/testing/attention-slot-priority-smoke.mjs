import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, swEval } from "./lib/cdp-client.mjs";
import { waitForExtensionServiceWorker } from "./lib/cdp-discovery.mjs";
import {
  buildExtensionBrowserArgs,
  closeBrowserByDebugPort,
  spawnBrowser,
} from "./lib/browser-process.mjs";
import {
  findFirstExistingExecutable,
  getSharedPlaywrightChromiumPathCandidates,
} from "./lib/browser-paths.mjs";
import { prepareExtensionUnderTest } from "./lib/extension-fixture.mjs";
import { fetchJson, getFreePort, rmWithRetry } from "./lib/test-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionDir = path.join(repoRoot, "extension");
const runRoot = path.join(
  os.tmpdir(),
  `zlw-attention-slot-priority-${process.pid}-${Date.now()}`
);

async function main() {
  const executablePath = findFirstExistingExecutable(
    getSharedPlaywrightChromiumPathCandidates()
  );

  if (!executablePath || !existsSync(executablePath)) {
    throw new Error("Shared Playwright Chromium executable was not found.");
  }

  await mkdir(runRoot, { recursive: true });

  const profileDir = path.join(runRoot, "profile");
  const extensionUnderTestDir = path.join(runRoot, "extension");
  const debugPort = await getFreePort();
  let child = null;
  let browserClient = null;
  let workerClient = null;

  try {
    await mkdir(profileDir, { recursive: true });
    const extensionFixture = await prepareExtensionUnderTest({
      extensionDir,
      targetDir: extensionUnderTestDir,
    });

    child = spawnBrowser(
      executablePath,
      buildExtensionBrowserArgs({
        profileDir,
        debugPort,
        extensionDir: extensionUnderTestDir,
        startUrl: "about:blank",
      }),
      { windowsHide: true }
    );

    const workerTarget = await waitForExtensionServiceWorker({
      debugPort,
      isTargetManifest({ manifest, permissions }) {
        return (
          manifest?.background?.service_worker === "service-worker.js" &&
          permissions.includes("tabs") &&
          permissions.includes("storage")
        );
      },
      failureLabel: "Smart Preload attention slot priority service worker",
    });
    workerClient = workerTarget.client;

    browserClient = await connectBrowser(debugPort);
    const result = await runAttentionSlotPriorityProbe(workerClient);

    assert.equal(result.activity.console.kind, "user-input");
    assert.equal(result.activity.console.weight, 1);
    assert.equal(result.activity.video.kind, "link-inactive");
    assert.equal(result.activity.video.weight, 0);
    assert.equal(result.activity.game.kind, "link-inactive");
    assert.equal(result.activity.game.weight, 0);
    assert.deepEqual(result.dwellShares, {
      101: 1,
      202: 0,
      303: 0,
    });
    assert.deepEqual(result.tabSlots, {
      101: 6,
      202: 0,
      303: 0,
    });
    assert.equal(result.consoleSelectedTabTargets, 6);
    assert.equal(result.videoSelectedTabTargets, 0);
    assert.equal(result.gameSelectedTabTargets, 0);

    console.log(
      JSON.stringify(
        {
          ok: true,
          runRoot,
          executablePath,
          extensionSourceRoot: extensionFixture.sourceRoot,
          usedPackagedExtension: extensionFixture.usedPackaged,
          result,
        },
        null,
        2
      )
    );
  } finally {
    workerClient?.close();
    browserClient?.close();

    if (child) {
      await closeBrowserByDebugPort({ child, debugPort });
    }

    await rmWithRetry(runRoot).catch(() => {});
  }
}

async function connectBrowser(debugPort) {
  const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
  if (!version?.webSocketDebuggerUrl) {
    throw new Error("Browser CDP websocket URL is unavailable");
  }
  return CdpClient.connect(version.webSocketDebuggerUrl);
}

async function runAttentionSlotPriorityProbe(workerClient) {
  return swEval(
    workerClient,
    async () => {
      globalThis.getPreloadResourcePressureState = async () => ({
        shouldDeferHiddenTabs: false,
        policy: "ignore",
        reason: "attention-slot-priority-smoke",
      });

      const settings = globalThis.ZeroLatencySettings.resolveEffectiveSettings({
        ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS,
        tracking: {
          ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.tracking,
          excludeHttpPages: false,
          excludeLocalPages: false,
          excludePrivateNetworkPages: false,
        },
        preloading: {
          ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.preloading,
          realPreloadEnabled: true,
          scheduler: {
            ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.preloading.scheduler,
            attentionPoolEnabled: true,
            attentionPoolMinutes: 30,
            attentionInputWindowSeconds: 30,
            attentionMediaPlaybackWeight: 0,
            attentionAudioPlaybackWeight: 0,
            attentionLinkInteractionSoftDecaySeconds: 60,
            attentionLinkInteractionSoftDecayWeight: 0.25,
            attentionLinkInteractionHardDecaySeconds: 180,
            attentionLinkInteractionHardDecayWeight: 0.1,
            attentionLinkInteractionZeroSeconds: 300,
            attentionSiteShareRatio: 0.5,
            tabTotalMin: 6,
            tabTotalMax: 6,
            tabHalfLifeTabs: 1,
          },
        },
        layout: {
          ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.layout,
          ruleCards: {
            items: {
              ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.layout.ruleCards.items,
              perPagePreloadLimit: {
                ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.layout.ruleCards.items
                  .perPagePreloadLimit,
                valueC: 6,
              },
              highWeightRankTab: {
                ...globalThis.ZeroLatencySettings.DEFAULT_SETTINGS.layout.ruleCards.items
                  .highWeightRankTab,
                valueC: 6,
              },
            },
          },
        },
      });

      const observedAt = Date.parse("2026-06-23T06:00:00.000Z");
      const iso = (offsetMs) => new Date(observedAt + offsetMs).toISOString();
      const runtimeOptions =
        globalThis.ZeroLatencyPreloadSchedulerAttention.buildPreloadAttentionRuntimeOptions({
          enabled: true,
          inputWindowMs: 30000,
          mediaPlaybackWeight: 0,
          audioPlaybackWeight: 0,
          linkSoftDecayMs: 60000,
          linkSoftDecayWeight: 0.25,
          linkHardDecayMs: 180000,
          linkHardDecayWeight: 0.1,
          linkZeroMs: 300000,
        });

      const activity = {
        console: globalThis.ZeroLatencyPreloadSchedulerAttention.resolveAttentionActivity(
          {
            observedAt: iso(0),
            documentVisible: true,
            lastUserInputAt: iso(-5000),
            lastLinkInteractionAt: iso(-5000),
          },
          runtimeOptions
        ),
        video: globalThis.ZeroLatencyPreloadSchedulerAttention.resolveAttentionActivity(
          {
            observedAt: iso(0),
            documentVisible: true,
            videoPlaybackActive: true,
            lastUserInputAt: null,
            lastLinkInteractionAt: null,
          },
          runtimeOptions
        ),
        game: globalThis.ZeroLatencyPreloadSchedulerAttention.resolveAttentionActivity(
          {
            observedAt: iso(0),
            documentVisible: true,
            lastUserInputAt: iso(-15000),
            lastLinkInteractionAt: iso(-310000),
          },
          runtimeOptions
        ),
      };

      const preloadState = createEmptyPreloadState();
      preloadState.scheduler.attentionPool =
        globalThis.ZeroLatencyPreloadSchedulerAttention.appendPreloadAttentionDuration(
          preloadState.scheduler.attentionPool,
          {
            tabId: 101,
            windowId: 10,
            pageUrl: "http://console.cloudflare-like.test/dashboard",
            durationMs: 10 * 60 * 1000,
            startedAt: iso(-10 * 60 * 1000),
            endedAt: iso(0),
          },
          {
            poolDurationMs: 30 * 60 * 1000,
            segmentDurationMs: 60 * 1000,
          }
        );

      const snapshots = [
        buildSnapshot({
          tabId: 101,
          pageUrl: "http://console.cloudflare-like.test/dashboard",
          label: "console",
          score: 100,
        }),
        buildSnapshot({
          tabId: 202,
          pageUrl: "http://idle-video.test/watch",
          label: "video",
          score: 100,
        }),
        buildSnapshot({
          tabId: 303,
          pageUrl: "http://idle-game.test/play",
          label: "game",
          score: 100,
        }),
      ];

      const dwellShares =
        globalThis.ZeroLatencyPreloadSchedulerAttention.computePreloadAttentionDwellShares(
          preloadState.scheduler.attentionPool,
          snapshots.map((snapshot) => ({
            tabId: snapshot.sourceTabId,
            pageUrl: snapshot.sourcePageUrl,
          })),
          { siteShareRatio: 0.5 }
        );

      const scheduled = await schedulePreloadCandidateSelectionSnapshots({
        snapshots,
        preloadState,
        settings,
        graph: null,
      });

      const byTabId = Object.fromEntries(
        scheduled.map((entry) => [String(entry.sourceTabId), entry])
      );

      return {
        activity: JSON.parse(JSON.stringify(activity)),
        dwellShares: JSON.parse(JSON.stringify(dwellShares)),
        tabSlots: Object.fromEntries(
          scheduled.map((entry) => [String(entry.sourceTabId), entry.tabSlots])
        ),
        nativeSlots: Object.fromEntries(
          scheduled.map((entry) => [String(entry.sourceTabId), entry.nativeSlots])
        ),
        consoleSelectedTabTargets: byTabId["101"]?.selection?.tabTargets?.length ?? 0,
        videoSelectedTabTargets: byTabId["202"]?.selection?.tabTargets?.length ?? 0,
        gameSelectedTabTargets: byTabId["303"]?.selection?.tabTargets?.length ?? 0,
      };

      function buildSnapshot({ tabId, pageUrl, label, score }) {
        const targets = Array.from({ length: 24 }, (_, index) => ({
          url: `${pageUrl}/target/${label}-${index + 1}`,
          nodeId: `${pageUrl}/target/${label}-${index + 1}`,
          score: score - index,
          strategy: "hidden-tab",
          targetHint: "_blank",
        }));
        const scoreSum = targets.reduce((sum, target) => sum + target.score, 0);

        return normalizePreloadCandidateSelectionSnapshot({
          sourceTabId: tabId,
          sourceWindowId: 10,
          sourcePageUrl: pageUrl,
          currentNodeId: pageUrl,
          currentPageTitle: `${label} page`,
          updatedAt: iso(0),
          selectedTargets: targets,
          scoreSignals: {
            tab: {
              scoreSum,
              candidateCount: targets.length,
              linkValueMultiplier: buildSchedulerLinkValueMultiplier(scoreSum),
            },
            native: {
              scoreSum: 0,
              candidateCount: 0,
              linkValueMultiplier: 1,
            },
          },
        });
      }
    },
    {},
    { timeoutMs: 20000 }
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
