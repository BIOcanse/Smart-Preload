(function () {
  async function getInteractionPreloadStatus(message, sender) {
    const context = await resolveInteractionPreloadContext(message, sender, {
      requirePreloadingEnabled: false,
    });

    if (!context.ok) {
      return {
        ok: false,
        preloaded: false,
        reason: context.reason,
      };
    }

    const preloadState = await loadPreloadState();
    const preloaded = hasExistingPreloadForInteractionTarget(preloadState, context);

    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.status", {
      sourceTabId: context.sourceTab.id,
      sourceWindowId: context.sourceTab.windowId,
      sourcePageUrl: context.sourcePageUrl,
      targetUrl: context.targetUrl,
      targetHint: context.targetHint,
      preloaded,
    });

    return {
      ok: true,
      preloaded,
    };
  }

  async function startInteractionPreload(message, sender) {
    const context = await resolveInteractionPreloadContext(message, sender);

    if (!context.ok) {
      return {
        ok: false,
        skipped: true,
        reason: context.reason,
      };
    }

    const target = buildInteractionPreloadTarget(context);
    const startedAt = new Date().toISOString();
    let preloadState = await loadPreloadState();
    let response = {
      ok: true,
      strategy: target.strategy,
      prerenderTargets: [],
      prefetchTargets: [],
    };

    preloadState = await reassignSourceTabRuntimeIfNeeded(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    );
    preloadState = await clearInteractionPreloadsForSource(preloadState, context, {
      trigger: context.trigger,
      keepUrl: context.targetUrl,
    });

    if (target.strategy === "hidden-tab") {
      preloadState = await upsertHiddenTabInteractionPreload(preloadState, context, target);
    } else {
      preloadState = upsertSyntheticInteractionPreload(preloadState, context, target, startedAt);
      response =
        target.strategy === "prerender"
          ? {
              ...response,
              prerenderTargets: [{ url: target.url, targetHint: target.targetHint }],
            }
          : {
              ...response,
              prefetchTargets: [{ url: target.url }],
            };
    }

    await savePreloadState(preloadState);
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.start", {
      sourceTabId: context.sourceTab.id,
      sourceWindowId: context.sourceTab.windowId,
      sourcePageUrl: context.sourcePageUrl,
      targetUrl: context.targetUrl,
      targetHint: context.targetHint,
      trigger: context.trigger,
      strategy: target.strategy,
    });
    return response;
  }

  async function cancelInteractionPreloads(message, sender) {
    const sourceTab = sender?.tab ?? null;
    const sourcePageUrl =
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";

    if (!sourceTab?.id || !sourceTab.windowId) {
      return {
        ok: true,
        skipped: true,
        reason: "missing-source-tab",
      };
    }

    let preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return {
        ok: true,
        skipped: true,
        reason: "preload-tab",
      };
    }

    preloadState = await clearInteractionPreloadsForSource(preloadState, {
      sourceTab,
      sourcePageUrl,
    });
    await savePreloadState(preloadState);
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.cancel", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      sourcePageUrl,
      reason: typeof message?.reason === "string" ? message.reason : "selection",
    });

    return { ok: true };
  }

  async function discardContextMenuInteractionHiddenTabPreload(context) {
    if (!context.sourceTab?.id || !context.sourceTab.windowId || !context.targetUrl) {
      return {
        removed: false,
        reason: "missing-context",
      };
    }

    let preloadState = await loadPreloadState();
    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    );
    const entry =
      sourceRuntimeEntry?.sourceTabRuntime?.hiddenTabEntriesByUrl?.[context.targetUrl] ?? null;

    if (entry?.interactionPreload?.trigger !== "contextmenu") {
      return {
        removed: false,
        reason: "no-contextmenu-hidden-entry",
      };
    }

    await closeTabIfExists(entry.tabId);
    delete sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl[context.targetUrl];
    markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, new Date().toISOString());
    pruneSourceTabRuntime(preloadState, context.sourceTab.windowId, String(context.sourceTab.id));
    await savePreloadState(preloadState);
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.discard-contextmenu", {
      sourceTabId: context.sourceTab.id,
      sourceWindowId: context.sourceTab.windowId,
      targetUrl: context.targetUrl,
      removedTabId: entry.tabId ?? null,
      reason: context.reason || "discard",
    });

    return {
      removed: true,
      tabId: entry.tabId ?? null,
    };
  }

  async function resolveInteractionPreloadContext(message, sender, options = {}) {
    if (await isExtensionServicePaused()) {
      return { ok: false, reason: "service-paused" };
    }

    const sourceTab = sender?.tab ?? null;
    const sourcePageUrl =
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";
    const targetUrl = normalizeNavigableUrl(message?.targetUrl || "", sourcePageUrl);

    if (!sourceTab?.id || !sourceTab.windowId) {
      return { ok: false, reason: "missing-source-tab" };
    }

    if (!sourcePageUrl || !isTrackableAndAllowedUrl(sourcePageUrl)) {
      return { ok: false, reason: "invalid-source-url" };
    }

    if (!targetUrl || !isTrackableAndAllowedUrl(targetUrl)) {
      return { ok: false, reason: "invalid-target-url" };
    }

    if (isExcludedTrackingPage(sourcePageUrl) || isExcludedTrackingPage(targetUrl)) {
      return { ok: false, reason: "excluded-tracking-page" };
    }

    const sourceWindow = await getWindowMaybe(sourceTab.windowId);

    if (sourceWindow?.type !== "normal") {
      return { ok: false, reason: "invalid-source-window" };
    }

    const settings = getEffectiveExtensionSettings();

    if (settings.preloading?.interactionPreloadEnabled === false) {
      return { ok: false, reason: "interaction-preload-disabled" };
    }

    const sourceIncognitoTab = {
      ...sourceTab,
      incognito: sourceTab.incognito === true || sourceWindow.incognito === true,
    };

    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        sourceIncognitoTab,
        settings
      )
    ) {
      const preloadState = await loadPreloadState();
      const cleanup =
        await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
          preloadState,
          settings,
          {
            tabs: [sourceIncognitoTab],
            reason: "interaction-preload",
          }
        );

      if (cleanup.mutated) {
        await savePreloadState(cleanup.preloadState);
      }

      return { ok: false, reason: "incognito-excluded" };
    }

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        sourceTab,
        settings
      )
    ) {
      const preloadState = await loadPreloadState();
      const cleanup =
        await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
          preloadState,
          settings,
          {
            tabs: [sourceTab],
            reason: "interaction-preload",
          }
        );

      if (cleanup.mutated) {
        await savePreloadState(cleanup.preloadState);
      }

      return { ok: false, reason: "proxy-skip" };
    }

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
        targetUrl,
        settings
      )
    ) {
      return { ok: false, reason: "proxy-target-skip" };
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return { ok: false, reason: "preload-tab" };
    }

    if (options.requirePreloadingEnabled !== false && settings.preloading.enabled !== true) {
      return { ok: false, reason: "preloading-disabled" };
    }

    const forceNewTab = message?.forceNewTab === true;
    const targetHint = forceNewTab || message?.targetHint === "_blank" ? "_blank" : "_self";
    const trigger = message?.trigger === "contextmenu" ? "contextmenu" : "hover";

    return {
      ok: true,
      sourceTab,
      sourcePageUrl,
      targetUrl,
      targetHint,
      trigger,
      forceNewTab,
      settings,
    };
  }

  function hasExistingPreloadForInteractionTarget(preloadState, context) {
    const sourceRuntime = getSourceTabRuntimeForWindow(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    )?.sourceTabRuntime;

    if (!sourceRuntime) {
      return false;
    }

    return Boolean(
      sourceRuntime.hiddenTabEntriesByUrl?.[context.targetUrl] ||
        sourceRuntime.prerenderEntriesByUrl?.[context.targetUrl] ||
        sourceRuntime.prefetchEntriesByUrl?.[context.targetUrl]
    );
  }

  function hasContextMenuInteractionHiddenTabPreload(preloadState, context) {
    if (!context.sourceTab?.id || !context.sourceTab.windowId || !context.targetUrl) {
      return false;
    }

    const sourceRuntime = getSourceTabRuntimeForWindow(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    )?.sourceTabRuntime;
    const entry = sourceRuntime?.hiddenTabEntriesByUrl?.[context.targetUrl] ?? null;

    return entry?.interactionPreload?.trigger === "contextmenu";
  }

  function buildInteractionPreloadTarget(context) {
    const isSameOrigin = isSameOriginUrl(context.sourcePageUrl, context.targetUrl);
    const targetNodeId = buildNodeSeed(context.targetUrl).nodeId;
    const transitionMetrics = {
      siteTransitionCount: 0,
      outboundPageTransitionCount: context.forceNewTab ? 1 : 0,
      intraSitePageTransitionCount: 0,
      pageTransitionCount: 0,
      isSameSite: buildNodeSeed(context.sourcePageUrl).nodeId === targetNodeId,
    };
    const candidate = {
      url: context.targetUrl,
      nodeId: targetNodeId,
      targetHint: context.targetHint,
      isSameOrigin,
      ...transitionMetrics,
    };
    const strategy = context.forceNewTab
      ? resolveForcedNewTabInteractionStrategy(context.settings)
      : typeof determinePreloadStrategy === "function"
        ? determinePreloadStrategy(candidate, context.settings)
        : isSameOrigin
          ? "prerender"
          : "prefetch";
    const now = new Date().toISOString();

    return {
      url: context.targetUrl,
      nodeId: targetNodeId,
      score: 0,
      scoreBreakdown: null,
      transitionMetrics,
      targetHint: context.targetHint,
      aiKeywordMatch: null,
      bookmarkPreload: null,
      interactionPreload: {
        trigger: context.trigger,
        targetHint: context.targetHint,
        startedAt: now,
        updatedAt: now,
      },
      siteSelection: null,
      strategy,
    };
  }

  async function upsertHiddenTabInteractionPreload(preloadState, context, target) {
    const pressureState =
      typeof getPreloadResourcePressureState === "function"
        ? await getPreloadResourcePressureState(context.settings)
        : null;

    if (pressureState?.shouldDeferHiddenTabs === true) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.hidden-tab.skip-pressure", {
        sourceTabId: context.sourceTab.id,
        sourceWindowId: context.sourceTab.windowId,
        targetUrl: context.targetUrl,
        policy: pressureState.policy,
        reason: pressureState.reason,
      });
      return preloadState;
    }

    const sourceRuntimeEntry = ensureSourceTabRuntime(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    );
    const existingEntries = sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl;
    const existingEntry = existingEntries[target.url];

    if (existingEntry) {
      const liveTab = await getTabMaybe(existingEntry.tabId);

      if (liveTab) {
        updateHiddenTabInteractionEntry(existingEntry, target, liveTab);
        markSourceRuntimeUpdated(
          preloadState,
          sourceRuntimeEntry,
          target.interactionPreload.updatedAt
        );
        return preloadState;
      }

      delete existingEntries[target.url];
    }

    const ensuredWindow = await globalThis.ZeroLatencyPreloadWindowManager.ensureWindow(
      preloadState,
      context.sourceTab.windowId
    );

    if (normalizePositiveInteger(ensuredWindow?.windowId) === null) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.hidden-tab.skip-window", {
        sourceTabId: context.sourceTab.id,
        sourceWindowId: context.sourceTab.windowId,
        targetUrl: context.targetUrl,
        reason: ensuredWindow?.reason ?? "missing-preload-window",
      });
      return preloadState;
    }

    existingEntries[target.url] = {
      tabId: null,
      requestedUrl: target.url,
      loadedUrl: null,
      nodeId: target.nodeId,
      score: target.score,
      scoreBreakdown: target.scoreBreakdown,
      transitionMetrics: target.transitionMetrics,
      aiKeywordMatch: null,
      bookmarkPreload: null,
      interactionPreload: target.interactionPreload,
      siteSelection: null,
      status: "queued",
      createdAt: target.interactionPreload.startedAt,
      updatedAt: target.interactionPreload.updatedAt,
    };
    await primePreloadEntry(ensuredWindow.windowId, existingEntries[target.url]);

    const updatedNormalWindowRuntime = getNormalWindowRuntime(
      preloadState,
      context.sourceTab.windowId
    );
    await globalThis.ZeroLatencyPreloadWindowManager.maintainHiddenState(ensuredWindow.windowId, {
      hiddenBySystem: updatedNormalWindowRuntime?.preloadWindow?.hiddenBySystem === true,
      hwnd: updatedNormalWindowRuntime?.preloadWindow?.hwnd ?? null,
      normalWindowRuntime: updatedNormalWindowRuntime,
      trigger: "interaction-preload",
    });
    markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, target.interactionPreload.updatedAt);
    return preloadState;
  }

  function updateHiddenTabInteractionEntry(entry, target, liveTab) {
    entry.nodeId = target.nodeId;
    entry.score = 0;
    entry.scoreBreakdown = null;
    entry.transitionMetrics = target.transitionMetrics;
    entry.aiKeywordMatch = null;
    entry.bookmarkPreload = null;
    entry.interactionPreload = target.interactionPreload;
    entry.siteSelection = null;
    entry.status = liveTab.status || entry.status;
    entry.loadedUrl = liveTab.url || entry.loadedUrl;
    entry.updatedAt = target.interactionPreload.updatedAt;
  }

  function upsertSyntheticInteractionPreload(preloadState, context, target, startedAt) {
    const sourceRuntimeEntry = ensureSourceTabRuntime(
      preloadState,
      context.sourceTab.windowId,
      String(context.sourceTab.id)
    );
    const targetMap =
      target.strategy === "prerender"
        ? sourceRuntimeEntry.sourceTabRuntime.prerenderEntriesByUrl
        : sourceRuntimeEntry.sourceTabRuntime.prefetchEntriesByUrl;

    targetMap[target.url] = {
      requestedUrl: target.url,
      nodeId: target.nodeId,
      score: 0,
      scoreBreakdown: null,
      transitionMetrics: target.transitionMetrics,
      status: target.strategy,
      strategy: target.strategy,
      targetHint: target.targetHint,
      aiKeywordMatch: null,
      bookmarkPreload: null,
      interactionPreload: {
        ...target.interactionPreload,
        startedAt,
        updatedAt: startedAt,
      },
      siteSelection: null,
      updatedAt: startedAt,
    };
    markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, startedAt);
    return preloadState;
  }

  async function clearInteractionPreloadsForSource(preloadState, context, options = {}) {
    const sourceTab = context.sourceTab;
    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      preloadState,
      sourceTab.windowId,
      String(sourceTab.id)
    );

    if (!sourceRuntimeEntry) {
      return preloadState;
    }

    const trigger =
      options.trigger === "contextmenu" ? "contextmenu" : options.trigger === "hover" ? "hover" : null;
    const keepUrl = typeof options.keepUrl === "string" ? options.keepUrl : "";
    let mutated = false;

    for (const [url, entry] of Object.entries(
      sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl || {}
    )) {
      if (!shouldClearInteractionEntry(entry, { trigger, keepUrl, url })) {
        continue;
      }

      await closeTabIfExists(entry.tabId);
      delete sourceRuntimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl[url];
      mutated = true;
    }

    mutated =
      clearSyntheticInteractionEntries(
        sourceRuntimeEntry.sourceTabRuntime.prerenderEntriesByUrl,
        { trigger, keepUrl }
      ) || mutated;
    mutated =
      clearSyntheticInteractionEntries(
        sourceRuntimeEntry.sourceTabRuntime.prefetchEntriesByUrl,
        { trigger, keepUrl }
      ) || mutated;

    if (mutated) {
      markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, new Date().toISOString());
      pruneSourceTabRuntime(preloadState, sourceTab.windowId, String(sourceTab.id));
    }

    return preloadState;
  }

  function clearSyntheticInteractionEntries(entriesByUrl, options) {
    let mutated = false;

    for (const [url, entry] of Object.entries(entriesByUrl || {})) {
      if (!shouldClearInteractionEntry(entry, { ...options, url })) {
        continue;
      }

      delete entriesByUrl[url];
      mutated = true;
    }

    return mutated;
  }

  function shouldClearInteractionEntry(entry, { trigger, keepUrl, url }) {
    if (!entry?.interactionPreload) {
      return false;
    }

    if (keepUrl && keepUrl === url) {
      return false;
    }

    return !trigger || entry.interactionPreload.trigger === trigger;
  }

  function markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, updatedAt) {
    sourceRuntimeEntry.sourceTabRuntime.updatedAt = updatedAt;
    sourceRuntimeEntry.normalWindowRuntime.updatedAt = updatedAt;
    preloadState.updatedAt = updatedAt;
  }

  function resolveForcedNewTabInteractionStrategy(settings) {
    return supportsHiddenTabPreloadStrategy(settings) ? "hidden-tab" : "prefetch";
  }

  globalThis.ZeroLatencyPreloadInteraction = {
    getInteractionPreloadStatus,
    startInteractionPreload,
    cancelInteractionPreloads,
    hasContextMenuInteractionHiddenTabPreload,
    discardContextMenuInteractionHiddenTabPreload,
  };
})();
