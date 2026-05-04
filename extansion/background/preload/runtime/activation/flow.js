const PRELOADED_TAB_ACTIVATION_WAIT_MS = 1200;
const PRELOADED_TAB_ACTIVATION_POLL_MS = 75;

async function activatePreloadedPage(message, sender) {
  if (await isExtensionServicePaused()) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.service-paused", {
      targetUrl: message?.url || null,
    });
    return { handled: false };
  }

  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.unsupported", {
      targetUrl: message?.url || null,
    });
    return { handled: false };
  }

  const sourceTab = sender?.tab;
  const openInNewTab = message?.openInNewTab === true;
  const resolutionExpiresAt = normalizeActivationDeadline(message?.resolutionExpiresAt);

  if (!sourceTab?.id || !sourceTab.windowId || !isTrackableAndAllowedUrl(message?.url || "")) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.invalid-request", {
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      targetUrl: message?.url || null,
      openInNewTab,
    });
    return { handled: false };
  }

  if (isActivationDeadlineExpired(resolutionExpiresAt)) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.deadline-expired", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      openInNewTab,
      stage: "before-resolution",
    });
    return { handled: false };
  }

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (sourceWindow?.type !== "normal") {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.invalid-source-window", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      sourceWindowType: sourceWindow?.type || null,
    });
    return { handled: false };
  }

  const sourceTabId = String(sourceTab.id);
  const activationResolution = await resolveActivatablePreloadedEntry({
    normalWindowId: sourceTab.windowId,
    sourceTabId,
    targetUrl: message.url,
    waitForReadyMs: openInNewTab ? 0 : PRELOADED_TAB_ACTIVATION_WAIT_MS,
  });

  if (await isExtensionServicePaused()) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.service-paused-after-wait", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      openInNewTab,
    });
    return { handled: false };
  }

  if (isActivationDeadlineExpired(resolutionExpiresAt)) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.deadline-expired", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      openInNewTab,
      stage: "after-resolution",
    });
    return { handled: false };
  }

  let preloadState = activationResolution.preloadState;
  const sourceRuntimeEntry = activationResolution.sourceRuntimeEntry;
  const entry = activationResolution.entry;
  const preloadedTab = activationResolution.preloadedTab;
  const resolvedEntryStatus = preloadedTab?.status || entry?.status || null;

  if (!entry || !sourceRuntimeEntry) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.miss", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      openInNewTab,
    });
    return { handled: false };
  }

  if (!preloadedTab) {
    delete sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl[message.url];
    pruneSourceTabRuntime(preloadState, sourceTab.windowId, sourceTabId);
    await savePreloadState(preloadState);
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.stale-entry", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      entryTabId: entry?.tabId ?? null,
    });
    return { handled: false };
  }

  const activatedWhileLoading = resolvedEntryStatus !== "complete";
  const trackingTargetUrl = resolveActivatedTrackingTargetUrl(message.url, preloadedTab, entry);

  if (activatedWhileLoading) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.loading-promoted", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      preloadedTabId: preloadedTab.id,
      status: resolvedEntryStatus,
      openInNewTab,
    });
  }

  if (isActivationDeadlineExpired(resolutionExpiresAt)) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.deadline-expired", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      openInNewTab,
      stage: "before-move",
    });
    return { handled: false };
  }

  const trackingState = await loadTrackingState();
  const nextTrackingState = await recordActivatedPreloadedTransition({
    trackingState,
    sourceTab,
    activatedTab: preloadedTab,
    targetUrl: trackingTargetUrl,
    keepSourceTab: openInNewTab,
  });

  await saveTrackingState(nextTrackingState);

  globalThis.clearKnownPreloadTab?.(preloadedTab.id);
  const movedTab = await chrome.tabs.move(preloadedTab.id, {
    windowId: sourceTab.windowId,
    index: (sourceTab.index ?? 0) + 1,
  });
  const activatedTab = Array.isArray(movedTab) ? movedTab[0] : movedTab;

  await ensureActivatedTabHasNavigableUrl(activatedTab, message.url);
  await chrome.tabs.update(activatedTab.id, { active: true });

  preloadState = await clearPreloadsForSourceTab(preloadState, sourceTab.windowId, sourceTabId, {
    keepTabIds: [activatedTab.id],
  });
  await savePreloadState(preloadState);

  if (!openInNewTab) {
    await chrome.tabs.remove(sourceTab.id);
  }

  try {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "sendMessage") === true) {
      await chrome.tabs.sendMessage(activatedTab.id, {
        type: "preload:collect-candidates",
      });
    }
  } catch (_error) {
    // The destination tab may not have a content script yet on some pages.
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.success", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl: message.url,
    trackingTargetUrl,
    activatedTabId: activatedTab.id,
    activatedWhileLoading,
    preloadedTabStatus: resolvedEntryStatus,
    openInNewTab,
  });

  return {
    handled: true,
    tabId: activatedTab.id,
  };
}

async function resolveActivatablePreloadedEntry({
  normalWindowId,
  sourceTabId,
  targetUrl,
  waitForReadyMs = 0,
}) {
  const deadline = Date.now() + Math.max(0, Number(waitForReadyMs) || 0);

  while (true) {
    const preloadState = await loadPreloadState();
    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      normalWindowId,
      sourceTabId
    );
    const entry = sourceRuntimeEntry?.sourceTabRuntime?.hiddenTabEntriesByUrl?.[targetUrl] ?? null;
    const preloadedTab = entry?.tabId ? await getTabMaybe(entry.tabId) : null;
    const resolvedStatus = preloadedTab?.status || entry?.status || null;

    if (entry && preloadedTab) {
      entry.status = resolvedStatus;
      entry.loadedUrl = preloadedTab.url || entry.loadedUrl;
      entry.updatedAt = new Date().toISOString();
      sourceRuntimeEntry.sourceTabRuntime.updatedAt = entry.updatedAt;
      sourceRuntimeEntry.normalWindowRuntime.updatedAt = entry.updatedAt;
      preloadState.updatedAt = entry.updatedAt;
    }

    if (!entry) {
      if (Date.now() >= deadline) {
        return {
          preloadState,
          sourceRuntimeEntry: null,
          entry: null,
          preloadedTab: null,
        };
      }
    } else if (!preloadedTab || resolvedStatus === "complete") {
      return {
        preloadState,
        sourceRuntimeEntry,
        entry,
        preloadedTab,
      };
    } else if (Date.now() >= deadline) {
      return {
        preloadState,
        sourceRuntimeEntry,
        entry,
        preloadedTab,
      };
    }

    await sleepPreloadedActivationPoll();
  }
}

async function sleepPreloadedActivationPoll() {
  await new Promise((resolve) => {
    setTimeout(resolve, PRELOADED_TAB_ACTIVATION_POLL_MS);
  });
}

function normalizeActivationDeadline(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function isActivationDeadlineExpired(deadline) {
  return Number.isFinite(deadline) && Date.now() >= deadline;
}

async function ensureActivatedTabHasNavigableUrl(activatedTab, targetUrl) {
  if (!activatedTab?.id || !targetUrl) {
    return;
  }

  const currentUrl = String(activatedTab.url || "");
  if (currentUrl && currentUrl !== "about:blank") {
    return;
  }

  await chrome.tabs.update(activatedTab.id, { url: targetUrl });
}

function resolveActivatedTrackingTargetUrl(requestedUrl, preloadedTab, entry) {
  const candidates = [preloadedTab?.url, entry?.loadedUrl, requestedUrl];

  for (const candidateUrl of candidates) {
    const normalizedCandidateUrl = normalizePageUrlForIndex(candidateUrl || "");

    if (normalizedCandidateUrl && isTrackableAndAllowedUrl(candidateUrl || "")) {
      return normalizedCandidateUrl;
    }
  }

  return requestedUrl;
}
