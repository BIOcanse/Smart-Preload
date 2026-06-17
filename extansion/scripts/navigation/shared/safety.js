(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { normalizeShortText } = namespace;

  function collectAnchorPreloadSafety(anchor) {
    const relTokens = String(anchor?.rel || anchor?.getAttribute?.("rel") || "")
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 12);

    return {
      downloadAttribute: anchor?.hasAttribute?.("download") === true,
      downloadFileName: normalizeShortText(anchor?.getAttribute?.("download") || ""),
      relTokens,
      typeAttr: normalizeShortText(anchor?.getAttribute?.("type") || "").toLowerCase(),
      pingAttribute: Boolean(String(anchor?.getAttribute?.("ping") || "").trim()),
    };
  }

  function shouldUseBrowserDefaultForPreloadSafety(anchor, targetUrl) {
    return inspectAnchorSideEffectPreloadSafety(anchor, targetUrl).skipPreload === true;
  }

  function inspectAnchorSideEffectPreloadSafety(anchor, targetUrl) {
    const safety = collectAnchorPreloadSafety(anchor);
    const inspectSideEffectCandidateSafety =
      globalThis.ZeroLatencyPreloadSafetyRules?.inspectSideEffectCandidateSafety;

    if (typeof inspectSideEffectCandidateSafety !== "function") {
      return {
        skipPreload: true,
        sideEffectBlocked: true,
        reason: "preload-safety-rules-unavailable",
        reasons: ["preload-safety-rules-unavailable"],
        sideEffectReasons: ["preload-safety-rules-unavailable"],
        preloadSafety: safety,
      };
    }

    return {
      ...inspectSideEffectCandidateSafety(
        {
          url: targetUrl,
          preloadSafety: safety,
        },
        targetUrl,
        location.href
      ),
      preloadSafety: safety,
    };
  }

  Object.assign(namespace, {
    collectAnchorPreloadSafety,
    inspectAnchorSideEffectPreloadSafety,
    shouldUseBrowserDefaultForPreloadSafety,
  });
})();
