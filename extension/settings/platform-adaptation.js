(() => {
  const MOBILE_USER_AGENT_PATTERN =
    /android|iphone|ipad|ipod|windows phone|iemobile|opera mini|webos|mobile/u;

  function detectMobilePlatform(navigatorLike = globalThis.navigator || {}) {
    if (navigatorLike.userAgentData?.mobile === true) {
      return true;
    }

    const userAgent = String(navigatorLike.userAgent || "").toLowerCase();

    if (MOBILE_USER_AGENT_PATTERN.test(userAgent)) {
      return true;
    }

    const platform = String(navigatorLike.platform || "").toLowerCase();
    const maxTouchPoints = Math.max(0, Number(navigatorLike.maxTouchPoints) || 0);
    const usesDesktopIpadUserAgent =
      (userAgent.includes("macintosh") || platform.includes("mac")) &&
      maxTouchPoints > 1;

    return usesDesktopIpadUserAgent;
  }

  function applyPlatformMarker({
    navigatorLike = globalThis.navigator || {},
    root = globalThis.document?.documentElement,
  } = {}) {
    const mobile = detectMobilePlatform(navigatorLike);

    root?.setAttribute?.("data-mobile-platform", mobile ? "true" : "false");
    return {
      mobile,
    };
  }

  const state = applyPlatformMarker();

  globalThis.ZeroLatencySettingsPlatformAdaptation = {
    detectMobilePlatform,
    applyPlatformMarker,
    isMobilePlatform: state.mobile,
  };
})();
