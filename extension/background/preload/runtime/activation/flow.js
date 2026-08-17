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

  // resolution.js 轮询循环里加载的快照。定点清理（clearStaleActivationEntry、
  // blockUnsafePreloadedActivationIfNeeded）已改为在 mutation lane 上重读后施加，不再
  // 使用这份快照；仅 clearSourceTabPreloadsAfterActivation 仍需要它，原因见 cleanup.js。
  const preloadState = activationResolution.preloadState;
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
    // 不再传 preloadState / sourceRuntimeEntry：它们是本流程早期的快照，被调用方会在
    // mutation lane 上重读最新状态并重新施加动作。
    await clearStaleActivationEntry({
      sourceTab,
      sourceTabId,
      targetUrl,
      entry,
    });
    return { handled: false };
  }

  const safetyResponse = await blockUnsafePreloadedActivationIfNeeded({
    sourceTab,
    sourceTabId,
    targetUrl,
    entry,
    preloadedTab,
  });

  if (safetyResponse) {
    return safetyResponse;
  }

  const activatedWhileLoading = resolvedEntryStatus !== "complete";
  const trackingTargetUrl = resolveActivatedTrackingTargetUrl(targetUrl, preloadedTab, entry);
  const incognitoGuard = await validatePreloadedActivationIncognitoContext({
    sourceTab,
    preloadedTab,
    targetWindowId,
    targetUrl,
  });

  if (!incognitoGuard.ok) {
    return incognitoGuard.response;
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

  await clearSourceTabPreloadsAfterActivation({
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
