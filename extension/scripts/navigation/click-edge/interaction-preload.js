(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    findNavigableAnchorFromEvent,
    getTrackedAnchorNavigation,
    normalizeNavigableHref,
    isPassivePrerenderContext,
    requestInteractionPreloadStatus,
    requestInteractionPreload,
    cancelInteractionPreloads,
    applyInteractionSpeculationRules,
    isTextSelectionActive,
  } = namespace;

  function handleLinkHover(event) {
    if (isPassivePrerenderContext() || isTextSelectionActive()) {
      return;
    }

    const anchor = findNavigableAnchorFromEvent(event);

    if (!anchor || event.defaultPrevented) {
      return;
    }

    // pointerover 会冒泡：鼠标在同一个链接内部从 <img> 移到 <span> 会再触发一次，
    // 卡片式链接（图 + 标题 + 摘要包在一个 <a> 里）扫过一次就是三四遍。
    //
    // 这个去重此前写在 getTrackedAnchorNavigation() 之后，等于每次都先付掉安全判定里的
    // 两次强制布局，才发现结果要丢弃。提到前面来 —— 该分支本来就不使用 navigation。
    // href 变化由 targetUrl 比对兜住（只解析 URL，不碰布局）。
    const existingIntent = namespace.state.hoverPreloadIntent;

    if (
      existingIntent &&
      existingIntent.cancelled !== true &&
      existingIntent.anchor === anchor &&
      existingIntent.targetUrl === normalizeNavigableHref(anchor.href)
    ) {
      namespace.recordLinkInteractionForAttention?.();
      return;
    }

    const navigation = getTrackedAnchorNavigation(event, { anchor });

    if (!navigation) {
      return;
    }

    namespace.recordLinkInteractionForAttention?.();

    const nextIntentId = (namespace.state.hoverPreloadSequence || 0) + 1;
    namespace.state.hoverPreloadSequence = nextIntentId;
    cancelPendingHoverPreloadIntent("replaced");

    const intent = {
      id: nextIntentId,
      anchor: navigation.anchor,
      sourcePageUrl: location.href,
      targetUrl: navigation.targetUrl,
      targetHint: navigation.navigationTarget,
      trigger: "hover",
      cancelled: false,
      started: false,
      readyToStart: false,
      preloadKnown: null,
      timerId: null,
    };
    namespace.state.hoverPreloadIntent = intent;

    void requestInteractionPreloadStatus({
      sourcePageUrl: intent.sourcePageUrl,
      targetUrl: intent.targetUrl,
      targetHint: intent.targetHint,
    }).then((status) => {
      if (!isCurrentHoverPreloadIntent(intent)) {
        return;
      }

      if (status?.reason === "interaction-preload-disabled") {
        cancelPendingHoverPreloadIntent("interaction-preload-disabled");
        return;
      }

      intent.preloadKnown = status?.preloaded === true;

      if (intent.readyToStart && intent.preloadKnown === false) {
        void startInteractionPreloadIntent(intent);
      }
    });

    intent.timerId = window.setTimeout(() => {
      if (!isCurrentHoverPreloadIntent(intent)) {
        return;
      }

      intent.timerId = null;
      intent.readyToStart = true;

      if (intent.preloadKnown === false) {
        void startInteractionPreloadIntent(intent);
      }
    }, constants.HOVER_PRELOAD_DELAY_MS);
  }

  function handleLinkHoverOut(event) {
    const intent = namespace.state.hoverPreloadIntent;

    if (!intent || intent.started) {
      return;
    }

    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && intent.anchor?.contains?.(relatedTarget)) {
      return;
    }

    cancelPendingHoverPreloadIntent("hover-out");
  }

  function handleLinkContextMenu(event) {
    if (isPassivePrerenderContext() || isTextSelectionActive()) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented) {
      return;
    }

    namespace.recordLinkInteractionForAttention?.();
    cancelPendingHoverPreloadIntent("contextmenu");
    void startInteractionPreload({
      sourcePageUrl: location.href,
      targetUrl: navigation.targetUrl,
      targetHint: "_blank",
      trigger: "contextmenu",
      forceNewTab: true,
    });
  }

  function cancelInteractionPreloadForSelection() {
    if (!isTextSelectionActive()) {
      return;
    }

    cancelPendingHoverPreloadIntent("selection");
    applyInteractionSpeculationRules?.({
      prerenderTargets: [],
      prefetchTargets: [],
    });
    void cancelInteractionPreloads?.({
      sourcePageUrl: location.href,
      reason: "selection",
    });
  }

  function cancelPendingHoverPreloadIntent(reason) {
    const intent = namespace.state.hoverPreloadIntent;
    void reason;

    if (!intent) {
      return;
    }

    intent.cancelled = true;
    window.clearTimeout(intent.timerId);
    namespace.state.hoverPreloadIntent = null;
  }

  function isCurrentHoverPreloadIntent(intent) {
    return (
      intent &&
      namespace.state.hoverPreloadIntent === intent &&
      intent.cancelled !== true &&
      intent.anchor?.isConnected !== false &&
      !isTextSelectionActive()
    );
  }

  async function startInteractionPreloadIntent(intent) {
    if (!isCurrentHoverPreloadIntent(intent) || intent.started) {
      return;
    }

    intent.started = true;
    await startInteractionPreload({
      sourcePageUrl: intent.sourcePageUrl,
      targetUrl: intent.targetUrl,
      targetHint: intent.targetHint,
      trigger: intent.trigger,
      forceNewTab: false,
    });
  }

  async function startInteractionPreload(payload) {
    const response = await requestInteractionPreload?.(payload);

    if (!response?.ok) {
      return;
    }

    if (
      Array.isArray(response.prerenderTargets) ||
      Array.isArray(response.prefetchTargets)
    ) {
      applyInteractionSpeculationRules?.({
        prerenderTargets: response.prerenderTargets ?? [],
        prefetchTargets: response.prefetchTargets ?? [],
      });
    }
  }

  Object.assign(namespace, {
    handleLinkHover,
    handleLinkHoverOut,
    handleLinkContextMenu,
    cancelInteractionPreloadForSelection,
  });
})();
