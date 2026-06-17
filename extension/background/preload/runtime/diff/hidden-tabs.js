(function () {
  const hiddenTabChannel = globalThis.ZeroLatencyHiddenTabDiffChannel;
  const hiddenTabSafety = globalThis.ZeroLatencyHiddenTabDiffSafety;
  const hiddenTabEntries = globalThis.ZeroLatencyHiddenTabDiffEntries;

  async function syncHiddenTabTargets(
    preloadState,
    normalWindowId,
    sourceTabId,
    targets,
    options = {}
  ) {
    const syncChannel = hiddenTabChannel.normalizeHiddenTabSyncChannel(options?.channel);
    const safeTargets = hiddenTabSafety.filterUnsafeHiddenTabTargets({
      normalWindowId,
      sourceTabId,
      targets,
    });
    const channelTargets = safeTargets.filter((target) =>
      hiddenTabChannel.shouldManageHiddenTabTargetForChannel(target, syncChannel)
    );
    const pressureState =
      typeof getPreloadResourcePressureState === "function"
        ? await getPreloadResourcePressureState(getEffectiveExtensionSettings())
        : null;

    if (pressureState?.shouldDeferHiddenTabs === true) {
      globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.resource-pressure-skip", {
        normalWindowId,
        sourceTabId,
        targetCount: channelTargets.length,
        channel: syncChannel,
        policy: pressureState.policy,
        reason: pressureState.reason,
      });
      return preloadState;
    }

    preloadState = await reassignSourceTabRuntimeIfNeeded(
      preloadState,
      normalWindowId,
      sourceTabId
    );

    const existingRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      normalWindowId,
      sourceTabId
    );

    if (!existingRuntimeEntry && channelTargets.length === 0) {
      return preloadState;
    }

    const sourceRuntimeEntry =
      existingRuntimeEntry ?? ensureSourceTabRuntime(preloadState, normalWindowId, sourceTabId);
    const existingEntries = getSourceTabPreloadChannelStore(
      sourceRuntimeEntry.sourceTabRuntime,
      "hiddenTab"
    );
    const desiredUrls = new Set(channelTargets.map((target) => target.url));
    let preloadWindowId = null;

    for (const [url, entry] of Object.entries(existingEntries)) {
      if (desiredUrls.has(url)) {
        continue;
      }

      if (!hiddenTabChannel.shouldManageExistingHiddenTabEntryForChannel(entry, syncChannel)) {
        continue;
      }

      await closeTabIfExists(entry.tabId);
      deleteSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab", url);
      globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.remove", {
        normalWindowId,
        sourceTabId,
        targetUrl: url,
        channel: syncChannel,
        removedTabId: entry?.tabId ?? null,
      });
    }

    for (const target of channelTargets) {
      const existingEntry = getSourceTabPreloadEntry(
        sourceRuntimeEntry.sourceTabRuntime,
        "hiddenTab",
        target.url
      );

      if (existingEntry) {
        if (
          !hiddenTabChannel.canUpdateExistingHiddenTabEntryForChannel(
            existingEntry,
            target,
            syncChannel
          )
        ) {
          continue;
        }

        const liveTab = await getTabMaybe(existingEntry.tabId);

        if (!liveTab) {
          deleteSourceTabPreloadEntry(
            sourceRuntimeEntry.sourceTabRuntime,
            "hiddenTab",
            target.url
          );
        } else {
          hiddenTabEntries.updateExistingHiddenTabEntryFromTarget(
            existingEntry,
            target,
            liveTab
          );
          continue;
        }
      }

      if (preloadWindowId === null) {
        const ensuredWindow = await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
          preloadState,
          normalWindowId
        );
        preloadWindowId = ensuredWindow.windowId;
        globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.ensure-window", {
          normalWindowId,
          sourceTabId,
          preloadWindowId,
          created: ensuredWindow?.created === true,
          hiddenBySystem: ensuredWindow?.hiddenBySystem === true,
          reason: ensuredWindow?.reason ?? null,
        });

        if (normalizePositiveInteger(preloadWindowId) === null) {
          return preloadState;
        }
      }

      const queuedEntry = hiddenTabEntries.buildQueuedHiddenTabEntryFromTarget(target);
      setSourceTabPreloadEntry(
        sourceRuntimeEntry.sourceTabRuntime,
        "hiddenTab",
        target.url,
        queuedEntry
      );
      globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.queue", {
        normalWindowId,
        sourceTabId,
        preloadWindowId,
        targetUrl: target.url,
        score: target.score,
        channel: syncChannel,
        bookmarkPreload: target.bookmarkPreload ?? null,
        siteSelection: target.siteSelection ?? null,
      });
      await primePreloadEntry(preloadWindowId, queuedEntry);
    }

    markSourceTabPreloadChannelsUpdated(preloadState, sourceRuntimeEntry);

    pruneSourceTabRuntime(preloadState, normalWindowId, sourceTabId);

    if (preloadWindowId !== null) {
      const updatedNormalWindowRuntime = getNormalWindowRuntime(preloadState, normalWindowId);
      await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(preloadWindowId, {
        hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
        hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
        normalWindowRuntime: updatedNormalWindowRuntime,
        trigger: "hidden-tab-sync",
      });
      globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.maintain-hidden", {
        normalWindowId,
        sourceTabId,
        preloadWindowId,
        hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
        hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
      });
    }

    return preloadState;
  }

  globalThis.ZeroLatencyHiddenTabPreloadDiff = {
    syncTargets: syncHiddenTabTargets,
    filterUnsafeTargets: hiddenTabSafety.filterUnsafeHiddenTabTargets,
  };
})();
