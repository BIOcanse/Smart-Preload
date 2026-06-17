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

  globalThis.ZeroLatencyPreloadInteraction = {
    getInteractionPreloadStatus,
    startInteractionPreload,
    cancelInteractionPreloads,
    hasContextMenuInteractionHiddenTabPreload,
    discardContextMenuInteractionHiddenTabPreload,
  };
})();
