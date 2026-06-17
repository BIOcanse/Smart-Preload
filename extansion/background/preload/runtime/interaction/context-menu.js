(function () {
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
    const incognitoRelease =
      await releaseContextMenuPreloadForIncognitoIfNeeded({
        sourceTab,
        targetTab,
        targetWindow,
        targetTabId,
        targetUrl,
        runtimeSettings,
      });

    if (incognitoRelease) {
      return incognitoRelease;
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
      await restoreActivatedContextMenuTarget(activation, targetWindowId);
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

  globalThis.ZeroLatencyContextMenuPreloadInteraction = {
    activateCreatedNavigationTarget,
    activateUpdatedTabNavigationTarget,
    buildContextMenuPreloadMissDebug,
  };
})();
