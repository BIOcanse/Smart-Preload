async function blockUnsafePreloadedActivationIfNeeded({
  preloadState,
  sourceRuntimeEntry,
  sourceTab,
  sourceTabId,
  targetUrl,
  entry,
  preloadedTab,
}) {
  const safetyDecision =
    globalThis.ZeroLatencyPreloadSafetyPolicy?.inspectPreloadCandidate?.(
      {
        url: targetUrl,
        realPreloadSafety: entry.realPreloadSafety ?? null,
      },
      targetUrl
    ) ?? null;

  if (safetyDecision?.realPreloadBlocked !== true && safetyDecision?.skipPreload !== true) {
    return null;
  }

  await closeTabIfExists(preloadedTab.id);
  deleteSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab", targetUrl);
  markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, new Date().toISOString());
  pruneSourceTabRuntime(preloadState, sourceTab.windowId, sourceTabId);
  await savePreloadState(preloadState);
  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.safety-blocked", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl,
    preloadedTabId: preloadedTab.id,
    reason: safetyDecision.reason || "unsafe-real-preload",
    reasons: safetyDecision.reasons || [],
  });
  return { handled: false, reason: "real-preload-safety-guard" };
}
