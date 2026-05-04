async function registerPreloadCandidates(message, sender) {
  if (await isExtensionServicePaused()) {
    return {
      ok: true,
      preloadedCount: 0,
      skipped: true,
      reason: "service-paused",
    };
  }

  const sourceTab = sender?.tab;

  if (!sourceTab?.id || !sourceTab.windowId) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  if (globalThis.isKnownPreloadContext?.(sourceTab.id, sourceTab.windowId) === true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.skip-preload-context", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      pageUrl: message?.pageUrl || sourceTab.url || "",
    });
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  if (!isTrackableAndAllowedUrl(message?.pageUrl || sourceTab.url || "")) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (!sourceWindow || sourceWindow.type !== "normal") {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  if (sourceTab.active !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.skip-inactive-tab", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      pageUrl: message?.pageUrl || sourceTab.url || "",
    });
    return {
      ok: true,
      preloadedCount: 0,
      skipped: true,
      reason: "inactive-source-tab",
    };
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, sourceTab.id)) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  const runtimeSettings = getEffectiveExtensionSettings();

  if (!runtimeSettings.preloading.enabled) {
    return { ok: true, preloadedCount: 0, skipped: true };
  }

  const featureSupport = globalThis.ZeroLatencySupport?.getBackgroundFeatureSupport?.() ?? {
    hiddenTabPreload: false,
  };

  let trackingState = await loadTrackingState();
  trackingState = await ensureCurrentPageTracked(
    trackingState,
    String(sourceTab.id),
    message.pageUrl || sourceTab.url || ""
  );
  const sourceTabId = String(sourceTab.id);
  const currentNodeId =
    trackingState.tabState[sourceTabId]?.nodeId ??
    buildNodeSeed(message.pageUrl || sourceTab.url).nodeId;
  const selection = await selectPreloadTargets({
    currentNodeId,
    sourceUrl: message.pageUrl || sourceTab.url,
    sourceWindowId: sourceTab.windowId,
    sourceTabId,
    currentPageTitle: typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab.title || "",
    currentPageTextDigest: typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
    currentPageContentFingerprint:
      typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
    candidateLinks: Array.isArray(message.links) ? message.links : [],
    graph: trackingState.graph,
    settings: runtimeSettings,
  });
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.selection", {
    sourceTabId,
    sourceWindowId: sourceTab.windowId,
    sourceUrl: message.pageUrl || sourceTab.url || "",
    candidateUrls: (Array.isArray(message.links) ? message.links : [])
      .map((link) => normalizeNavigableUrl(link?.url, message.pageUrl || sourceTab.url || ""))
      .filter(Boolean)
      .slice(0, 12),
    selectedTargets: selection.selectedTargets.map((target) => ({
      url: target.url,
      strategy: target.strategy,
      score: target.score,
      transitionMetrics: target.transitionMetrics ?? null,
      scoreBreakdown: target.scoreBreakdown ?? null,
      targetHint: target.targetHint,
    })),
  });
  globalThis.ZeroLatencyDiagnostics?.record?.("prediction.final-top", {
    sourceTabId,
    sourceWindowId: sourceTab.windowId,
    sourceUrl: message.pageUrl || sourceTab.url || "",
    candidateCount: Array.isArray(message.links) ? message.links.length : 0,
    selectedTargets: selection.selectedTargets.map((target, index) => ({
      rank: index + 1,
      url: target.url,
      nodeId: target.nodeId,
      strategy: target.strategy,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      siteSelection: target.siteSelection ?? null,
      targetHint: target.targetHint,
    })),
    tabTargets: selection.tabTargets.map((target) => target.url),
    prerenderTargets: selection.prerenderTargets.map((target) => target.url),
    prefetchTargets: selection.prefetchTargets.map((target) => target.url),
  });

  if (await isExtensionServicePaused()) {
    return {
      ok: true,
      preloadedCount: 0,
      skipped: true,
      reason: "service-paused-after-selection",
    };
  }

  await queueMutation(async () => {
    if (await isExtensionServicePaused()) {
      return;
    }

    let latestPreloadState = await loadPreloadState();
    latestPreloadState = await synchronizePreloadsForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.tabTargets
    );
    latestPreloadState = synchronizePrerenderEntriesForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.selectedTargets.filter((target) => target.strategy === "prerender")
    );
    latestPreloadState = synchronizePrefetchEntriesForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.selectedTargets.filter((target) => target.strategy === "prefetch")
    );
    await savePreloadState(latestPreloadState);
  });

  return {
    ok: true,
    preloadedCount: selection.tabTargets.length,
    prerenderCount: selection.prerenderTargets.length,
    prefetchCount: selection.prefetchTargets.length,
    prerenderTargets: selection.prerenderTargets,
    prefetchTargets: selection.prefetchTargets,
    contentScriptPolicy: {
      ignoreWaterfallDynamicLinks:
        runtimeSettings.preloading.ignoreWaterfallDynamicLinks !== false,
    },
    crossSiteCurrentTabSwapEnabled:
      isCrossSiteCurrentTabSwapStrategyEnabled(runtimeSettings),
    featureSupport,
    targets: selection.selectedTargets.map((target) => ({
      url: target.url,
      score: target.score,
      nodeId: target.nodeId,
      targetHint: target.targetHint,
      scoreBreakdown: target.scoreBreakdown ?? null,
      transitionMetrics: target.transitionMetrics ?? null,
      aiKeywordMatch: target.aiKeywordMatch ?? null,
      siteSelection: target.siteSelection ?? null,
      strategy: target.strategy,
    })),
  };
}

async function ensureCurrentPageTracked(trackingState, tabId, pageUrl) {
  const normalizedPageUrl = normalizePageUrlForIndex(pageUrl);

  if (!normalizedPageUrl) {
    return trackingState;
  }

  const trackedTabState = trackingState.tabState?.[tabId] ?? null;
  const trackedPageUrl = normalizePageUrlForIndex(trackedTabState?.url || "");

  if (trackedPageUrl === normalizedPageUrl) {
    return trackingState;
  }

  return queueMutation(async () => {
    const latestTrackingState = await loadTrackingState();
    const latestTrackedPageUrl = normalizePageUrlForIndex(
      latestTrackingState.tabState?.[tabId]?.url || ""
    );

    if (latestTrackedPageUrl === normalizedPageUrl) {
      return latestTrackingState;
    }

    const nextTrackingState = await applyTrackingEvent(latestTrackingState, {
      type: "set-current-page",
      tabId,
      targetNode: buildNodeSeed(normalizedPageUrl),
      occurredAt: new Date().toISOString(),
      url: normalizedPageUrl,
    });

    await saveTrackingState(nextTrackingState);
    return nextTrackingState;
  });
}
