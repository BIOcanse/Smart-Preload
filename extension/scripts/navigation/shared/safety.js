(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { state, normalizeShortText } = namespace;

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

    return combineAnchorPreloadSafetyDecisions({
      sideEffectDecision: inspectSideEffectCandidateSafety(
        {
          url: targetUrl,
          preloadSafety: safety,
        },
        targetUrl,
        location.href
      ),
      sensitiveSiteDecision: inspectSensitiveAnchorPreloadSafety(anchor, targetUrl),
      preloadSafety: safety,
    });
  }

  function inspectSensitiveAnchorPreloadSafety(anchor, targetUrl) {
    if (state.skipSensitivePages === false) {
      return {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      };
    }

    return (
      globalThis.ZeroLatencySensitiveSiteRules?.inspectUrl?.(targetUrl, {
        baseUrl: location.href,
        anchorText: normalizeShortText(anchor?.innerText || anchor?.textContent || ""),
        nearbyText: normalizeShortText(anchor?.parentElement?.innerText || ""),
        titleAttr: normalizeShortText(anchor?.getAttribute?.("title") || ""),
        ariaLabel: normalizeShortText(anchor?.getAttribute?.("aria-label") || ""),
      }) ?? {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      }
    );
  }

  function shouldSkipSensitivePagePreload(rawUrl = location.href) {
    if (state.skipSensitivePages === false) {
      return false;
    }

    return (
      globalThis.ZeroLatencySensitiveSiteRules?.inspectUrl?.(rawUrl, {
        baseUrl: location.href,
      })?.blocked === true
    );
  }

  function combineAnchorPreloadSafetyDecisions({
    sideEffectDecision,
    sensitiveSiteDecision,
    preloadSafety,
  }) {
    const sideEffectReasons = Array.isArray(sideEffectDecision?.sideEffectReasons)
      ? sideEffectDecision.sideEffectReasons
      : [];
    const sensitiveSiteReasons = Array.isArray(sensitiveSiteDecision?.reasons)
      ? sensitiveSiteDecision.reasons
      : [];
    const reasons = [...new Set([...(sideEffectDecision?.reasons || []), ...sensitiveSiteReasons])];

    return {
      skipPreload:
        sideEffectDecision?.skipPreload === true ||
        sensitiveSiteDecision?.blocked === true,
      sideEffectBlocked: sideEffectDecision?.sideEffectBlocked === true,
      sensitiveSiteBlocked: sensitiveSiteDecision?.blocked === true,
      reason: reasons[0] || "",
      reasons,
      sideEffectReasons,
      sensitiveSiteReasons,
      sensitiveSiteCategories: sensitiveSiteDecision?.categories || [],
      sensitiveSiteEvidence: sensitiveSiteDecision?.evidence || null,
      preloadSafety,
    };
  }

  Object.assign(namespace, {
    collectAnchorPreloadSafety,
    inspectAnchorSideEffectPreloadSafety,
    inspectSensitiveAnchorPreloadSafety,
    shouldSkipSensitivePagePreload,
    shouldUseBrowserDefaultForPreloadSafety,
  });
})();
