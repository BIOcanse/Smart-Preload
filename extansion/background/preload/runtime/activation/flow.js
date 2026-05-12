const PRELOADED_TAB_ACTIVATION_WAIT_MS = 1200;

async function activatePreloadedPage(message, sender) {
  const request = await resolvePreloadActivationRequest(message, sender);

  if (!request.ok) {
    return request.response;
  }

  const { sourceTab, sourceTabId, openInNewTab, resolutionExpiresAt, targetUrl } = request;
  const activationResolution = await resolveActivatablePreloadedEntry({
    normalWindowId: sourceTab.windowId,
    sourceTabId,
    targetUrl,
    waitForReadyMs: openInNewTab ? 0 : PRELOADED_TAB_ACTIVATION_WAIT_MS,
  });

  if (await isExtensionServicePaused()) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.service-paused-after-wait", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl,
      openInNewTab,
    });
    return { handled: false };
  }

  if (
    isActivationDeadlineExpired(resolutionExpiresAt, {
      sourceTab,
      targetUrl,
      openInNewTab,
      stage: "after-resolution",
    })
  ) {
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
      targetUrl,
      openInNewTab,
    });
    return { handled: false };
  }

  if (!preloadedTab) {
    await clearStaleActivationEntry({
      preloadState,
      sourceRuntimeEntry,
      sourceTab,
      sourceTabId,
      targetUrl,
      entry,
    });
    return { handled: false };
  }

  const activatedWhileLoading = resolvedEntryStatus !== "complete";
  const trackingTargetUrl = resolveActivatedTrackingTargetUrl(targetUrl, preloadedTab, entry);

  if (activatedWhileLoading) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.loading-promoted", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl,
      preloadedTabId: preloadedTab.id,
      status: resolvedEntryStatus,
      openInNewTab,
    });
  }

  if (
    isActivationDeadlineExpired(resolutionExpiresAt, {
      sourceTab,
      targetUrl,
      openInNewTab,
      stage: "before-move",
    })
  ) {
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

  const activatedTab = await promotePreloadedTabToSourceWindow({
    sourceTab,
    preloadedTab,
    targetUrl,
    openInNewTab,
  });

  preloadState = await clearSourceTabPreloadsAfterActivation({
    preloadState,
    sourceTab,
    sourceTabId,
    activatedTab,
  });

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.success", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl,
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
