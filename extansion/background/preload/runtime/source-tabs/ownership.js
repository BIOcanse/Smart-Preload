async function reassignSourceTabRuntimeIfNeeded(preloadState, normalWindowId, sourceTabId) {
  const existingOwner = findSourceTabRuntime(preloadState, sourceTabId);

  if (!existingOwner || Number(existingOwner.normalWindowId) === Number(normalWindowId)) {
    return preloadState;
  }

  preloadState = await clearPreloadsForSourceTab(
    preloadState,
    existingOwner.normalWindowId,
    sourceTabId
  );

  const previousWindowRuntime = getNormalWindowRuntime(
    preloadState,
    existingOwner.normalWindowId
  );

  if (previousWindowRuntime && !hasHiddenPreloadEntriesForNormalWindow(previousWindowRuntime)) {
    if (shouldKeepWarmPreloadWindow(previousWindowRuntime)) {
      await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
        preloadState,
        existingOwner.normalWindowId
      );
    } else {
      await globalThis.ZeroLatencyPreloadWindowManager.closeWindowForNormalWindow(
        preloadState,
        existingOwner.normalWindowId
      );
      pruneNormalWindowRuntime(preloadState, existingOwner.normalWindowId);
    }
  }

  return preloadState;
}

async function handleActivatedSourceTab(activeInfo) {
  const tabId = normalizePositiveInteger(activeInfo?.tabId);
  const windowId = normalizePositiveInteger(activeInfo?.windowId);

  if (tabId === null || windowId === null) {
    return;
  }

  let preloadState = await loadPreloadState();
  const normalWindowRuntime = getNormalWindowRuntime(preloadState, windowId);
  let didMutate = false;

  if (normalWindowRuntime) {
    for (const sourceTabId of Object.keys(normalWindowRuntime.sourceTabs || {})) {
      if (Number(sourceTabId) === tabId) {
        continue;
      }

      await clearSpeculationRulesForTab(sourceTabId);
      preloadState = await clearPreloadsForSourceTab(
        preloadState,
        windowId,
        sourceTabId
      );
      didMutate = true;
    }

    const latestNormalWindowRuntime = getNormalWindowRuntime(preloadState, windowId);

    if (
      latestNormalWindowRuntime &&
      !hasHiddenPreloadEntriesForNormalWindow(latestNormalWindowRuntime)
    ) {
      if (shouldKeepWarmPreloadWindow(latestNormalWindowRuntime)) {
        const ensuredWindow = await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
          preloadState,
          windowId
        );
        if (ensuredWindow?.created === true) {
          didMutate = true;
        }
      } else if (
        await globalThis.ZeroLatencyPreloadWindowManager.closeWindowForNormalWindow(
          preloadState,
          windowId
        )
      ) {
        didMutate = true;
        pruneNormalWindowRuntime(preloadState, windowId);
      }
    }
  }

  if (didMutate) {
    await savePreloadState(preloadState);
  }

  await requestPreloadCandidateRefreshForTab(tabId);
}

async function clearSpeculationRulesForTab(tabId) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(normalizedTabId, {
      type: "preload:clear-speculation-rules",
    });
  } catch (_error) {
    // The old active tab may not have a live content script anymore.
  }
}
