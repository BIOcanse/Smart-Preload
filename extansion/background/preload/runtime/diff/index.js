(function () {
  async function applySourceTabSelection({
    preloadState,
    sourceWindowId,
    sourceTabId,
    selection,
  }) {
    const selectedTargets = Array.isArray(selection?.selectedTargets)
      ? selection.selectedTargets
      : [];
    const hiddenTabTargets = Array.isArray(selection?.tabTargets)
      ? selection.tabTargets
      : [];
    const bookmarkTargets =
      globalThis.ZeroLatencyBookmarkPreloadDiff?.filterTargets?.(hiddenTabTargets) ?? [];
    const scheduledHiddenTabTargets = hiddenTabTargets.filter(
      (target) => !target?.bookmarkPreload
    );

    let nextPreloadState = await globalThis.ZeroLatencyBookmarkPreloadDiff.syncTargets(
      preloadState,
      sourceWindowId,
      sourceTabId,
      bookmarkTargets
    );
    nextPreloadState = await globalThis.ZeroLatencyHiddenTabPreloadDiff.syncTargets(
      nextPreloadState,
      sourceWindowId,
      sourceTabId,
      scheduledHiddenTabTargets
    );
    nextPreloadState = globalThis.ZeroLatencySpeculationPreloadDiff.syncPrerenderTargets(
      nextPreloadState,
      sourceWindowId,
      sourceTabId,
      selectedTargets.filter((target) => target.strategy === "prerender")
    );
    nextPreloadState = globalThis.ZeroLatencySpeculationPreloadDiff.syncPrefetchTargets(
      nextPreloadState,
      sourceWindowId,
      sourceTabId,
      selectedTargets.filter((target) => target.strategy === "prefetch")
    );

    return nextPreloadState;
  }

  globalThis.ZeroLatencyPreloadDiff = {
    applySourceTabSelection,
    syncHiddenTabTargets: (...args) =>
      globalThis.ZeroLatencyHiddenTabPreloadDiff.syncTargets(...args),
    syncPrerenderTargets: (...args) =>
      globalThis.ZeroLatencySpeculationPreloadDiff.syncPrerenderTargets(...args),
    syncPrefetchTargets: (...args) =>
      globalThis.ZeroLatencySpeculationPreloadDiff.syncPrefetchTargets(...args),
  };
})();
