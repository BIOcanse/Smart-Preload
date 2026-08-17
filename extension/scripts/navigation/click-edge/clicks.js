(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    getTrackedAnchorNavigation,
    isGoogleSearchInternalModeNavigation,
    isSameOriginNavigationUrl,
    isPassivePrerenderContext,
    sendNavigationPrimeSource,
    sendNavigationLinkIntent,
    requestClickNavigationResolutionWithTimeout,
    executeNavigationResolution,
    openReservedBlankWindow,
    anchorSuppressesReferrer,
  } = namespace;

  async function handleClick(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented || event.button !== 0) {
      return;
    }

    namespace.recordLinkInteractionForAttention?.();
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

    // 同源导航：后台的 tryActivateClickPreload 被 `!isSameOriginNavigation` 挡住
    // （background/navigation/manager.js:61-89 与 :91），两条激活路径都不可达，
    // 拦截换不来任何预加载接管。所以让浏览器原生导航——页面自己的点击处理器
    // 照常运行（SPA 路由不再被打断），也不必为一次必然落到
    // navigate-current-tab 的往返付出代价。
    //
    // 学习消息仍按原样发出，后台行为完全不变；只是不等待响应。sendMessage 会
    // 唤醒 service worker 并投递，处理器照跑，文档销毁只影响响应回传。
    if (isSameOriginNavigationUrl?.(navigation.targetUrl) === true) {
      void requestClickNavigationResolutionWithTimeout(
        {
          sourcePageUrl: location.href,
          targetUrl: navigation.targetUrl,
          targetHint: clickPlan.targetHint,
          resolutionExpiresAt:
            Date.now() + constants.CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS,
        },
        0
      );
      return;
    }

    // rel="noreferrer"：作者显式要求不发 Referer，而接管后的两条执行路径都会违背它
    // （location.assign 必带 Referer；window.open 的特性串里没有 noreferrer）。
    // 整条不接管，交还浏览器。见 shared/safety.js 的 anchorSuppressesReferrer。
    if (anchorSuppressesReferrer?.(navigation.anchor) === true) {
      return;
    }

    // 预留窗口必须在 preventDefault **之前**开，且要能在失败时退回浏览器默认行为。
    //
    // window.open 只能在用户激活态内调用，所以 `_blank` 的接管必须先占一个窗口，等后台
    // 决议回来再把它导航过去。若这一步被弹窗拦截器挡住返回 null，那么 await 之后再调
    // window.open 同样会被挡（那时早已脱离用户激活态）—— 此前的代码在这种情况下
    // preventDefault 已经生效，于是**点击彻底静默失效**，而浏览器自己的 `_blank` 导航
    // 本来是能正常工作的（用户发起的链接点击不受弹窗拦截）。
    const reservedWindow = clickPlan.reserveBlankWindow ? openReservedBlankWindow() : null;

    if (clickPlan.reserveBlankWindow && !reservedWindow) {
      return;
    }

    // 跨源：这里才有真实预加载可接管，需要取消浏览器默认导航。
    // 只 preventDefault，不 stopPropagation——扩展已经拿到事件了，阻断传播对
    // 扩展没有任何收益，却会让页面自己的处理器（统计、onClick 行为）收不到点击。
    event.preventDefault();

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

    namespace.recordLinkInteractionForAttention?.();
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

    namespace.recordLinkInteractionForAttention?.();
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
