(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    getTrackedAnchorNavigation,
    isGoogleSearchInternalModeNavigation,
    isPassivePrerenderContext,
    sendNavigationPrimeSource,
    sendNavigationLinkIntent,
    requestClickNavigationResolutionWithTimeout,
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

  Object.assign(namespace, {
    handleClick,
    handleAuxClick,
    primeSourcePageForNavigation,
  });
})();
