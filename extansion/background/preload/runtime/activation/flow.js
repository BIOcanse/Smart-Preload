const PRELOADED_TAB_ACTIVATION_WAIT_MS = 1200;

async function activatePreloadedPage(message, sender) {
  const request = await resolvePreloadActivationRequest(message, sender);

  if (!request.ok) {
    return request.response;
  }

  const {
    sourceTab,
    sourceTabId,
    openInNewTab,
    targetWindowId,
    targetIndex,
    resolutionExpiresAt,
    targetUrl,
  } = request;
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
  const destinationWindowId = targetWindowId ?? sourceTab.windowId;
  const destinationWindow = await getWindowMaybe(destinationWindowId);
  const sourceDestinationMatch =
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
      sourceTab,
      null,
      destinationWindow
    );
  const sourcePreloadMatch =
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
      sourceTab,
      preloadedTab,
      null
    );

  if (sourceDestinationMatch?.matches === false || sourcePreloadMatch?.matches === false) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-mismatch", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl,
      preloadedTabId: preloadedTab.id,
      targetWindowId: destinationWindowId,
      sourceIncognito: sourcePreloadMatch?.sourceIncognito ?? sourceTab?.incognito === true,
      preloadedIncognito: preloadedTab?.incognito === true,
      destinationIncognito: destinationWindow?.incognito === true,
    });
    return { handled: false, reason: "incognito-context-mismatch" };
  }

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
    targetWindowId,
    targetIndex,
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
    targetWindowId,
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
