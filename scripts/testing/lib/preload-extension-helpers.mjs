import { swEval } from "./cdp-client.mjs";
import { sleep } from "./test-utils.mjs";

export async function configureRealPreloadTestState(
  serviceWorker,
  {
    diagnosticsEnabled = true,
    preloadWindowWatchdogEnabled = true,
    forceMinimize = false,
    nativeTotalSlots = 8,
    tabTotalSlots = 8,
    nativePerPageSlots = 8,
    tabPerPageSlots = 8,
    resetPreload = true,
  } = {}
) {
  const options = {
    diagnosticsEnabled,
    preloadWindowWatchdogEnabled,
    forceMinimize,
    nativeTotalSlots,
    tabTotalSlots,
    nativePerPageSlots,
    tabPerPageSlots,
    resetPreload,
  };
  let lastState = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await writeRealPreloadTestState(serviceWorker, options);
    lastState = await waitForStableRealPreloadTestState(serviceWorker, 2000);

    if (
      lastState?.preloadingEnabled === true &&
      lastState?.realPreloadEnabled === true &&
      lastState?.effectiveRealPreloadEnabled === true &&
      lastState?.currentTabSwap === true &&
      lastState?.servicePaused === false
    ) {
      return lastState;
    }
  }

  throw new Error(
    `Failed to configure real preload test state: ${JSON.stringify(lastState)}`
  );
}

async function waitForStableRealPreloadTestState(serviceWorker, durationMs) {
  const deadline = Date.now() + Math.max(250, Number(durationMs) || 250);
  let lastState = null;

  while (Date.now() < deadline) {
    await sleep(250);
    lastState = await readRealPreloadTestState(serviceWorker);
  }

  return lastState;
}

async function writeRealPreloadTestState(serviceWorker, options) {
  return swEval(
    serviceWorker,
    async ({
      diagnosticsEnabled,
      preloadWindowWatchdogEnabled,
      forceMinimize,
      nativeTotalSlots,
      tabTotalSlots,
      nativePerPageSlots,
      tabPerPageSlots,
      resetPreload,
    }) => {
      await queueMutation(async () => {
        const settings = globalThis.ZeroLatencySettings.cloneSettings(
          globalThis.ZeroLatencySettings.DEFAULT_SETTINGS
        );
        settings.tracking.excludeHttpPages = false;
        settings.tracking.excludeLocalPages = false;
        settings.tracking.excludePrivateNetworkPages = false;
        settings.preloading.enabled = true;
        settings.preloading.realPreloadEnabled = true;
        settings.preloading.aiPrediction.enabled = false;
        settings.preloadWindow.watchdogEnabled = preloadWindowWatchdogEnabled === true;
        settings.preloadWindow.forceMinimize = forceMinimize === true;
        settings.experiments.crossSiteCurrentTabSwap = true;
        settings.diagnostics.enabled = diagnosticsEnabled === true;
        settings.layout.ruleCards.items.nativePerPagePreloadLimit.valueC = nativePerPageSlots;
        settings.layout.ruleCards.items.highWeightRank.valueC = nativePerPageSlots;
        settings.layout.ruleCards.items.perPagePreloadLimit.valueC = tabPerPageSlots;
        settings.layout.ruleCards.items.highWeightRankTab.valueC = tabPerPageSlots;
        settings.preloading.scheduler.nativeTotalMin = nativeTotalSlots;
        settings.preloading.scheduler.nativeTotalMax = nativeTotalSlots;
        settings.preloading.scheduler.tabTotalMin = tabTotalSlots;
        settings.preloading.scheduler.tabTotalMax = tabTotalSlots;

        const storedSettings = await globalThis.ZeroLatencySettings.saveSettings(
          chrome.storage.local,
          settings
        );
        globalThis.backgroundState.setCachedSettings(storedSettings);

        const serviceState = await loadServiceState();
        serviceState.paused = false;
        serviceState.updatedAt = new Date().toISOString();
        await saveServiceState(serviceState);

        if (resetPreload === true) {
          await savePreloadState(createEmptyPreloadState());
        }

        await globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();
      });
      return true;
    },
    options
  );
}

async function readRealPreloadTestState(serviceWorker) {
  return swEval(serviceWorker, async () => {
    const effectiveSettings = getEffectiveExtensionSettings();
    const stored = await chrome.storage.local.get(
      globalThis.ZeroLatencySettings.SETTINGS_STORAGE_KEY
    );
    const storedSettings =
      stored?.[globalThis.ZeroLatencySettings.SETTINGS_STORAGE_KEY] ?? null;
    const serviceState = await loadServiceState();
    return {
      preloadingEnabled: effectiveSettings?.preloading?.enabled === true,
      realPreloadEnabled: effectiveSettings?.preloading?.realPreloadEnabled === true,
      effectiveRealPreloadEnabled:
        effectiveSettings?.preloading?.effectiveRealPreloadEnabled === true,
      allNative:
        globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
          effectiveSettings
        ) === true,
      currentTabSwap: effectiveSettings?.experiments?.crossSiteCurrentTabSwap === true,
      servicePaused: serviceState?.paused === true,
      storedRealPreloadEnabled: storedSettings?.preloading?.realPreloadEnabled === true,
      storedCurrentTabSwap: storedSettings?.experiments?.crossSiteCurrentTabSwap === true,
    };
  });
}

export async function waitForBackgroundReady(serviceWorker, timeoutMs = 10000) {
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

export async function requestCandidateRefresh(serviceWorker, tabId) {
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

export async function waitForTabComplete(serviceWorker, tabId, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await swEval(
      serviceWorker,
      async ({ tabId }) => {
        const tab = await chrome.tabs.get(tabId);
        return { status: tab.status, url: tab.url };
      },
      { tabId }
    );

    if (status.status === "complete") {
      await sleep(500);
      return status;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for tab ${tabId} to complete`);
}

export async function waitForContextMenuHiddenEntry(
  serviceWorker,
  sourceTabId,
  targetUrl,
  timeoutMs = 8000
) {
  const startedAt = Date.now();
  let lastEntry = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastEntry = await readContextMenuHiddenEntry(serviceWorker, sourceTabId, targetUrl);

    if (lastEntry?.found === true && lastEntry.trigger === "contextmenu") {
      return lastEntry;
    }

    await sleep(200);
  }

  throw new Error(
    `Timed out waiting for contextmenu hidden preload: ${JSON.stringify(lastEntry)}`
  );
}

export async function readContextMenuHiddenEntry(serviceWorker, sourceTabId, targetUrl) {
  return swEval(
    serviceWorker,
    async ({ sourceTabId, targetUrl }) => {
      const preloadState = await loadPreloadState();
      const runtimeEntry = findSourceTabRuntime(preloadState, sourceTabId);
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
    { sourceTabId, targetUrl }
  );
}
