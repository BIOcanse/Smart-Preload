(function () {
  function buildClickNavigationContext(message, sender) {
    const sourceTab = sender?.tab ?? null;
    const sourcePageUrl =
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";
    const targetUrl = typeof message?.targetUrl === "string" ? message.targetUrl : "";
    const targetHint = message?.targetHint === "_blank" ? "_blank" : "_self";
    const resolutionExpiresAt = normalizeClickResolutionDeadline(
      message?.resolutionExpiresAt
    );
    const indexedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl);
    const indexedTargetUrl = normalizePageUrlForIndex(targetUrl);

    return {
      sourceTab,
      sourcePageUrl,
      targetUrl,
      targetHint,
      resolutionExpiresAt,
      indexedSourcePageUrl,
      indexedTargetUrl,
      isValid: Boolean(
        sourceTab?.id && targetUrl && indexedSourcePageUrl && indexedTargetUrl
      ),
      isSameOriginNavigation: Boolean(
        sourcePageUrl && targetUrl && isSameOriginUrl(sourcePageUrl, targetUrl)
      ),
    };
  }

  function normalizeClickResolutionDeadline(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
  }

  function isClickResolutionDeadlineExpired(deadline) {
    return Number.isFinite(deadline) && Date.now() >= deadline;
  }

  globalThis.ZeroLatencyNavigationClickContext = {
    buildClickNavigationContext,
    normalizeClickResolutionDeadline,
    isClickResolutionDeadlineExpired,
  };
})();
