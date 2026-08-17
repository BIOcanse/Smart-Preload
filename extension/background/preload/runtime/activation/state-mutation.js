// 激活路径上对 preloadState 的写入统一走这里。
//
// 纪律：preloadState 的读改写必须整体在 mutation lane 上完成，见
// docs/internal/invariants.md 第 1 条。激活路径的难点在于它天然违反这条——preloadState
// 在 activation/resolution.js 的轮询循环里加载，之后还要经过真实的标签激活、临时标签
// 关闭、窗口聚焦才走到保存，直接保存那份快照会把这期间 mutation lane（标签事件、
// watchdog、调度）的写入整体覆盖掉。
//
// 也不能简单地把整段包进 queueMutation：那会让 mutation 队列在每次点击激活时停摆几百
// 毫秒，而 webNavigation.onCommitted 等事件都排在那条队列上，对一个延迟产品是净负。
//
// 所以采用项目已有的「保存前重读重放」模式（learning/foreground-pages/record.js:16-34
// 是同一形状）：临界区里只做一次读改写，不含任何 Chrome 操作；调用方持有的
// preloadState 和 sourceRuntimeEntry 一律视为陈旧，在这里基于最新状态重新定位。
async function applySourceTabPreloadMutation({ normalWindowId, sourceTabId, apply }) {
  return queueMutation(async () => {
    const latestPreloadState = await loadPreloadState();
    const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
      latestPreloadState,
      normalWindowId,
      sourceTabId
    );
    // apply 返回 undefined 表示就地修改了 latestPreloadState；返回新对象则以新对象为准
    // （clearPreloadsForSourceTab 就是后者）。
    const nextPreloadState =
      (await apply(latestPreloadState, sourceRuntimeEntry)) ?? latestPreloadState;

    await savePreloadState(nextPreloadState);
    return nextPreloadState;
  });
}
