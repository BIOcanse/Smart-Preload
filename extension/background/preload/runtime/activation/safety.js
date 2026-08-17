async function blockUnsafePreloadedActivationIfNeeded({
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

  // 关标签是 Chrome 操作，必须留在临界区外面——否则 mutation 队列会被它阻塞。
  await closeTabIfExists(preloadedTab.id);

  // 传进来的 preloadState / sourceRuntimeEntry 都是激活流程早期的陈旧快照，直接保存会
  // 覆盖 mutation lane 的并发写入。重读后重新施加同一个语义动作，
  // 见 docs/internal/invariants.md 第 1 条。
  await applySourceTabPreloadMutation({
    normalWindowId: sourceTab.windowId,
    sourceTabId,
    apply(latestPreloadState, latestSourceRuntimeEntry) {
      if (!latestSourceRuntimeEntry) {
        return latestPreloadState;
      }

      deleteSourceTabPreloadEntry(
        latestSourceRuntimeEntry.sourceTabRuntime,
        "hiddenTab",
        targetUrl
      );
      markSourceRuntimeUpdated(
        latestPreloadState,
        latestSourceRuntimeEntry,
        new Date().toISOString()
      );
      pruneSourceTabRuntime(latestPreloadState, sourceTab.windowId, sourceTabId);
      return latestPreloadState;
    },
  });
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
