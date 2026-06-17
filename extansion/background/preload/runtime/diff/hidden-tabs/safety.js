(function () {
  function filterUnsafeHiddenTabTargets({ normalWindowId, sourceTabId, targets }) {
    const safeTargets = [];

    for (const target of Array.isArray(targets) ? targets : []) {
      if (
        globalThis.ZeroLatencyPreloadSafetyPolicy?.shouldBlockRealPreload?.(
          target,
          target?.url
        ) === true
      ) {
        const decision =
          target?.realPreloadSafety ??
          globalThis.ZeroLatencyPreloadSafetyPolicy?.inspectPreloadCandidate?.(
            target,
            target?.url
          ) ??
          {};
        globalThis.ZeroLatencyDebugEvents?.record?.("hidden-tab.sync.safety-skip", {
          normalWindowId,
          sourceTabId,
          targetUrl: target?.url || "",
          reason: decision.reason || "unsafe-real-preload",
          reasons: decision.reasons || [],
        });
        continue;
      }

      safeTargets.push(target);
    }

    return safeTargets;
  }

  globalThis.ZeroLatencyHiddenTabDiffSafety = {
    filterUnsafeHiddenTabTargets,
  };
})();
