(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    isGoogleSearchInternalModeNavigation,
    isPassivePrerenderContext,
    sendNavigationPrimeSource,
    sendNavigationLinkIntent,
    requestClickNavigationResolutionWithTimeout,
    requestInteractionPreloadStatus,
    requestInteractionPreload,
    cancelInteractionPreloads,
    applyInteractionSpeculationRules,
    executeNavigationResolution,
    openReservedBlankWindow,
  } = namespace;

  async function handleClick(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented || event.button !== 0) {
      return;
    }

    const clickPlan = getPrimaryClickHandlingPlan(event, navigation);

    if (clickPlan.mode === "record-link-intent") {
      await sendNavigationLinkIntent(location.href, navigation.targetUrl, clickPlan.targetHint, {
        skipBehaviorLearning: clickPlan.skipBehaviorLearning === true,
        userOverride: clickPlan.userOverride === true,
      });
      return;
    }

    if (clickPlan.mode === "allow-browser-default") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const reservedWindow = clickPlan.reserveBlankWindow ? openReservedBlankWindow() : null;
    const resolutionTimeoutMs = reservedWindow
      ? constants.BLANK_CLICK_RESOLUTION_TIMEOUT_MS
      : constants.CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS;
    const resolutionExpiresAt = Date.now() + resolutionTimeoutMs;
    const resolution = await requestClickNavigationResolutionWithTimeout(
      {
        sourcePageUrl: location.href,
        targetUrl: navigation.targetUrl,
        targetHint: clickPlan.targetHint,
        resolutionExpiresAt,
      },
      resolutionTimeoutMs
    );

    executeNavigationResolution(resolution, {
      targetUrl: navigation.targetUrl,
      targetHint: clickPlan.targetHint,
      reservedWindow,
    });
  }

  async function handleAuxClick(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (event.button !== 1) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented) {
      return;
    }

    await sendNavigationLinkIntent(location.href, navigation.targetUrl, "_blank", {
      skipBehaviorLearning: true,
      userOverride: true,
    });
  }

  async function primeSourcePageForNavigation(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (event.button === 2) {
      return;
    }

    if (!getTrackedAnchorNavigation(event)) {
      return;
    }

    await sendNavigationPrimeSource(location.href);
  }

  function handleLinkHover(event) {
    if (isPassivePrerenderContext() || isTextSelectionActive()) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented) {
      return;
    }

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

  function isTextSelectionActive() {
    const selection = window.getSelection?.();

    return Boolean(
      selection &&
        selection.isCollapsed === false &&
        String(selection.toString() || "").trim()
    );
  }

  function getPrimaryClickHandlingPlan(event, navigation) {
    const modifierManagedClick = isModifierManagedNewTabClick(event);

    if (modifierManagedClick) {
      return {
        mode: "record-link-intent",
        targetHint: "_blank",
        reserveBlankWindow: false,
        skipBehaviorLearning: true,
        userOverride: true,
      };
    }

    if (event.altKey) {
      return {
        mode: "allow-browser-default",
        targetHint: navigation.rawNavigationTarget,
        reserveBlankWindow: false,
      };
    }

    if (isGoogleSearchInternalModeNavigation(location.href, navigation.targetUrl)) {
      return {
        mode: "allow-browser-default",
        targetHint: navigation.rawNavigationTarget,
        reserveBlankWindow: false,
      };
    }

    return {
      mode: "resolve-in-background",
      targetHint: navigation.navigationTarget,
      reserveBlankWindow: navigation.navigationTarget === "_blank",
    };
  }

  function isModifierManagedNewTabClick(event) {
    return event.metaKey || event.ctrlKey || event.shiftKey;
  }

  function getTrackedAnchorNavigation(event) {
    const anchor = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.href);

    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    if (anchor.hasAttribute("download")) {
      return null;
    }

    const targetUrl = normalizeNavigableHref(anchor.href);
    const rawNavigationTarget = getAnchorNavigationTarget(anchor);
    const navigationTarget = resolveManagedNavigationTarget(
      location.href,
      targetUrl,
      rawNavigationTarget
    );

    if (!targetUrl || !navigationTarget) {
      return null;
    }

    return {
      anchor,
      targetUrl,
      rawNavigationTarget,
      navigationTarget,
    };
  }

  Object.assign(namespace, {
    handleClick,
    handleAuxClick,
    primeSourcePageForNavigation,
    handleLinkHover,
    handleLinkHoverOut,
    handleLinkContextMenu,
    cancelInteractionPreloadForSelection,
    getTrackedAnchorNavigation,
  });
})();
