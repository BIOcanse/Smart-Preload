function resolveInteractionPreloadTargetContext({ message, sourceTab, sourcePageUrl, settings }) {
  const targetUrl = normalizeNavigableUrl(message?.targetUrl || "", sourcePageUrl);

  if (!targetUrl || !isTrackableAndAllowedUrl(targetUrl)) {
    return { ok: false, reason: "invalid-target-url" };
  }

  if (isExcludedTrackingPage(sourcePageUrl) || isExcludedTrackingPage(targetUrl)) {
    return { ok: false, reason: "excluded-tracking-page" };
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
      targetUrl,
      settings
    )
  ) {
    return { ok: false, reason: "proxy-target-skip" };
  }

  const safetyDecision =
    globalThis.ZeroLatencyPreloadSafetyPolicy?.inspectPreloadCandidate?.(
      {
        url: targetUrl,
        targetHint: message?.targetHint,
        trigger: message?.trigger,
      },
      targetUrl,
      settings
    ) ?? null;

  if (safetyDecision?.skipPreload === true || safetyDecision?.realPreloadBlocked === true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-interaction.safety-skip", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      sourcePageUrl,
      targetUrl,
      reason: safetyDecision.reason || "unsafe-interaction-preload",
      reasons: safetyDecision.reasons || [],
    });
    return { ok: false, reason: "real-preload-safety-guard" };
  }

  return {
    ok: true,
    targetUrl,
    realPreloadSafety: safetyDecision,
  };
}
