(function () {
  async function syncBookmarkTargets(preloadState, normalWindowId, sourceTabId, targets) {
    return globalThis.ZeroLatencyHiddenTabPreloadDiff.syncTargets(
      preloadState,
      normalWindowId,
      sourceTabId,
      targets,
      { channel: "bookmark" }
    );
  }

  function filterBookmarkTargets(targets) {
    return (Array.isArray(targets) ? targets : []).filter((target) =>
      Boolean(target?.bookmarkPreload)
    );
  }

  globalThis.ZeroLatencyBookmarkPreloadDiff = {
    syncTargets: syncBookmarkTargets,
    filterTargets: filterBookmarkTargets,
  };
})();
