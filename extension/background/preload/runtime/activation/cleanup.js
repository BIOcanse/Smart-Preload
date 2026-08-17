// 写入一律经 applySourceTabPreloadMutation（activation/state-mutation.js），原因见那里
// 的说明：调用方持有的 preloadState / sourceRuntimeEntry 都是激活流程早期的陈旧快照。
async function clearStaleActivationEntry({ sourceTab, sourceTabId, targetUrl, entry }) {
  await applySourceTabPreloadMutation({
    normalWindowId: sourceTab.windowId,
    sourceTabId,
    apply(preloadState, sourceRuntimeEntry) {
      // source tab 可能在这期间已被并发关闭，那就没有要清理的条目了。
      if (!sourceRuntimeEntry) {
        return preloadState;
      }

      deleteSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab", targetUrl);
      pruneSourceTabRuntime(preloadState, sourceTab.windowId, sourceTabId);
      return preloadState;
    },
  });

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.stale-entry", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl,
    entryTabId: entry?.tabId ?? null,
  });
}

// 这一个**故意**不走 applySourceTabPreloadMutation，两个原因都经实测确认：
//
// 1. clearPreloadsForSourceTab 内部对每个非保留条目 `await closeTabIfExists`
//    （source-tabs/hidden-tabs.js:35），把它放进 mutation lane 等于让真实的关标签
//    操作占住临界区，而 webNavigation.onCommitted 等事件都排在那条队列上。
// 2. 它的语义是「清空该 source tab 除激活项外的全部预加载」，**依赖求值时机**：
//    用陈旧快照执行只清掉快照里那些；换成重读后的最新状态，会把调度器在这期间
//    新建的预加载一并清掉。
//
// 实测（click-intercept-navigation-smoke）：改成重读重放后 preloadedBeforeClick
// 从 9/8 掉到 0-1、activationAttempts 从 10 掉到 0-2，即预加载基本不再发生。
//
// 因此这一处的丢更新风险保留未修。正确做法应当是把动作降级为「删除快照里那批
// 具体 URL」而不是「清空当前全部」，并把关标签移到临界区外——属于独立改动。
// 见 docs/internal/invariants.md 第 1 条与审查报告 H4 专节。
async function clearSourceTabPreloadsAfterActivation({
  preloadState,
  sourceTab,
  sourceTabId,
  activatedTab,
}) {
  const nextPreloadState = await clearPreloadsForSourceTab(
    preloadState,
    sourceTab.windowId,
    sourceTabId,
    {
      keepTabIds: [activatedTab.id],
    }
  );
  await savePreloadState(nextPreloadState);
  return nextPreloadState;
}
