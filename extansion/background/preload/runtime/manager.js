(function () {
  // High-level runtime supervisor. Keep message/runtime/watchdog entry points
  // calling this boundary instead of reaching deep helpers directly.
  async function registerCandidates(message, sender) {
    return registerPreloadCandidates(message, sender);
  }

  async function activateIfReady(message, sender) {
    return activatePreloadedPage(message, sender);
  }

  async function getInteractionPreloadStatus(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.getInteractionPreloadStatus(message, sender);
  }

  async function startInteractionPreload(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.startInteractionPreload(message, sender);
  }

  async function cancelInteractionPreloads(message, sender) {
    return globalThis.ZeroLatencyPreloadInteraction.cancelInteractionPreloads(message, sender);
  }

  async function activateCreatedNavigationTarget(details, options = {}) {
    const sourceTab = await getTabMaybe(details?.sourceTabId);
    const targetTabId = normalizePositiveInteger(details?.tabId);
    const targetUrl =
      typeof details?.url === "string"
        ? normalizeNavigableUrl(details.url, sourceTab?.url || "")
        : "";
    const targetTab = targetTabId === null ? null : await getTabMaybe(targetTabId);
    const targetWindow =
      Number.isFinite(targetTab?.windowId) ? await getWindowMaybe(targetTab.windowId) : null;

    if (!sourceTab?.id || targetTabId === null || !targetUrl) {
      return { handled: false };
    }

    if (options.requireContextMenuInteractionPreload === true) {
      const preloadState = await loadPreloadState();

      if (isPreloadTab(preloadState, targetTabId)) {
        return {
          handled: false,
          reason: "target-is-preload-tab",
        };
      }

      if (
        !globalThis.ZeroLatencyPreloadInteraction.hasContextMenuInteractionHiddenTabPreload(
          preloadState,
          {
            sourceTab,
            targetUrl,
          }
        )
      ) {
        return {
          handled: false,
          reason: "no-contextmenu-interaction-preload",
          debug: buildContextMenuPreloadMissDebug(preloadState, {
            sourceTab,
            targetUrl,
          }),
        };
      }
    }

    const runtimeSettings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;
    const incognitoMatch =
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
        sourceTab,
        targetTab,
        targetWindow
      ) ?? {
        sourceIncognito: sourceTab?.incognito === true,
        targetIncognito: targetTab?.incognito === true || targetWindow?.incognito === true,
        matches:
          (sourceTab?.incognito === true) ===
          (targetTab?.incognito === true || targetWindow?.incognito === true),
      };
    const shouldReleaseForIncognito =
      incognitoMatch.matches !== true ||
      (incognitoMatch.sourceIncognito === true &&
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.isIncognitoPreloadExclusionEnabled?.(
          runtimeSettings
        ) === true);

    if (shouldReleaseForIncognito) {
      const reason =
        incognitoMatch.sourceIncognito === true &&
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.isIncognitoPreloadExclusionEnabled?.(
          runtimeSettings
        ) === true
          ? "incognito-excluded"
          : incognitoMatch.targetIncognito === true
            ? "incognito-target"
            : "incognito-context-mismatch";
      const discarded =
        await globalThis.ZeroLatencyPreloadInteraction.discardContextMenuInteractionHiddenTabPreload(
          {
            sourceTab,
            targetUrl,
            reason,
          }
        );
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-release", {
        sourceTabId: sourceTab.id,
        sourceWindowId: sourceTab.windowId,
        targetTabId,
        targetWindowId: targetTab?.windowId ?? null,
        targetUrl,
        sourceIncognito: incognitoMatch.sourceIncognito,
        targetIncognito: incognitoMatch.targetIncognito,
        discarded,
      });
      return {
        handled: false,
        reason: `${reason}-released`,
        discarded,
      };
    }

    const targetWindowId = Number.isFinite(targetTab?.windowId) ? targetTab.windowId : null;
    const targetIndex = Number.isFinite(targetTab?.index) ? targetTab.index : null;
    const activation = await activatePreloadedPage(
      {
        url: targetUrl,
        openInNewTab: true,
        targetWindowId,
        targetIndex,
      },
      { tab: sourceTab }
    );

    if (activation?.handled === true && activation.tabId !== targetTabId) {
      await closeTabIfExists(targetTabId);
    }

    return activation;
  }

  async function activateUpdatedTabNavigationTarget(details) {
    const tab = details?.tab ?? null;
    const sourceTabId = normalizePositiveInteger(tab?.openerTabId);
    const targetTabId = normalizePositiveInteger(details?.tabId ?? tab?.id);
    const targetUrl =
      typeof details?.changeInfo?.url === "string"
        ? details.changeInfo.url
        : typeof tab?.pendingUrl === "string"
          ? tab.pendingUrl
          : typeof tab?.url === "string"
            ? tab.url
            : "";

    if (sourceTabId === null || targetTabId === null || !targetUrl) {
      return {
        handled: false,
        reason: "missing-opener-or-target",
      };
    }

    return activateCreatedNavigationTarget(
      {
        sourceTabId,
        tabId: targetTabId,
        url: targetUrl,
        timeStamp: Date.now(),
      },
      {
        requireContextMenuInteractionPreload: true,
      }
    );
  }

  function buildContextMenuPreloadMissDebug(preloadState, { sourceTab, targetUrl }) {
    const sourceRuntime = getSourceTabRuntimeForWindow(
      preloadState,
      sourceTab?.windowId,
      sourceTab?.id
    )?.sourceTabRuntime;
    const hiddenEntries = sourceRuntime?.hiddenTabEntriesByUrl || {};

    return {
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      targetUrl,
      hiddenEntryCount: Object.keys(hiddenEntries).length,
      hasExactEntry: Boolean(hiddenEntries[targetUrl]),
      hiddenEntryUrls: Object.keys(hiddenEntries).slice(0, 12),
      exactEntryTrigger: hiddenEntries[targetUrl]?.interactionPreload?.trigger ?? null,
      exactEntryStatus: hiddenEntries[targetUrl]?.status ?? null,
      exactEntryTabId: hiddenEntries[targetUrl]?.tabId ?? null,
    };
  }

  async function maintain() {
    await globalThis.ZeroLatencyPreloadWindowManager.maintainPolicy();
  }

  async function ensureWarmWindows() {
    await globalThis.ZeroLatencyPreloadWindowManager.ensureWarmWindows();
  }

  async function cleanupErroneousWindows() {
    await globalThis.ZeroLatencyPreloadWindowManager.cleanupErroneousWindowsNow();
  }

  globalThis.ZeroLatencyPreloadRuntimeManager = {
    registerCandidates,
    activateIfReady,
    getInteractionPreloadStatus,
    startInteractionPreload,
    cancelInteractionPreloads,
    activateCreatedNavigationTarget,
    activateUpdatedTabNavigationTarget,
    maintain,
    ensureWarmWindows,
    cleanupErroneousWindows,
  };
})();
