(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { constants, state } = namespace;

  function syncContentScriptPreloadPolicy(policy) {
    if (typeof policy?.ignoreWaterfallDynamicLinks === "boolean") {
      state.ignoreWaterfallDynamicLinks = policy.ignoreWaterfallDynamicLinks;
    }

    if (typeof policy?.skipSensitivePages === "boolean") {
      state.skipSensitivePages = policy.skipSensitivePages;
    }

    if (!state.ignoreWaterfallDynamicLinks) {
      resetWaterfallBaseline();
    }
  }

  function resetWaterfallBaseline() {
    state.fixedCandidateUrlSet = null;
    state.waterfallBaselineStartedAt = 0;
    state.waterfallBaselineLocked = false;
  }

  function filterWaterfallDynamicLinks(links) {
    if (!state.ignoreWaterfallDynamicLinks) {
      return links;
    }

    if (links.length === 0) {
      return links;
    }

    if (!state.fixedCandidateUrlSet) {
      state.fixedCandidateUrlSet = new Set();
      state.waterfallBaselineStartedAt = Date.now();
    }

    if (!state.waterfallBaselineLocked) {
      for (const link of links) {
        if (link?.url) {
          state.fixedCandidateUrlSet.add(link.url);
        }
      }

      if (shouldLockWaterfallBaseline()) {
        state.waterfallBaselineLocked = true;
      }

      return links;
    }

    return links.filter((link) => state.fixedCandidateUrlSet.has(link.url));
  }

  function shouldLockWaterfallBaseline() {
    if (!state.fixedCandidateUrlSet || state.fixedCandidateUrlSet.size === 0) {
      return false;
    }

    return (
      document.readyState !== "loading" ||
      Date.now() - state.waterfallBaselineStartedAt >=
        constants.WATERFALL_BASELINE_MAX_UNLOCKED_MS
    );
  }

  Object.assign(namespace, {
    syncContentScriptPreloadPolicy,
    resetWaterfallBaseline,
    filterWaterfallDynamicLinks,
  });
})();
