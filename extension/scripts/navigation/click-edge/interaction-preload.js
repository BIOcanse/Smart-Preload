(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    getTrackedAnchorNavigation,
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

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented) {
      return;
    }

    namespace.recordLinkInteractionForAttention?.();
    const existingIntent = namespace.state.hoverPreloadIntent;
    if (
      existingIntent &&
      existingIntent.cancelled !== true &&
      existingIntent.anchor === navigation.anchor &&
      existingIntent.targetUrl === navigation.targetUrl
    ) {
      return;
    }

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
