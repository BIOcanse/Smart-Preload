(function () {
  const { DEFAULT_PRELOAD_CAP_GROWTH_TABS } =
    globalThis.ZeroLatencyPreloadSchedulerAllocationConstants;

  function resolveAsymptoticPreloadCap({
    tabCount,
    minCap,
    maxCap,
    halfLifeTabs,
    growthTabs = DEFAULT_PRELOAD_CAP_GROWTH_TABS,
  } = {}) {
    const normalizedMinCap = normalizeSchedulerCap(minCap, 0);
    const normalizedMaxCap = Math.max(normalizedMinCap, normalizeSchedulerCap(maxCap, normalizedMinCap));
    const normalizedTabCount = Math.max(1, Math.trunc(Number(tabCount) || 1));
    const normalizedGrowthTabs = Math.max(
      1,
      Number(halfLifeTabs ?? growthTabs) || DEFAULT_PRELOAD_CAP_GROWTH_TABS
    );

    if (normalizedMinCap === normalizedMaxCap) {
      return normalizedMinCap;
    }

    const rawCap =
      normalizedMaxCap -
      (normalizedMaxCap - normalizedMinCap) *
        2 ** (-(normalizedTabCount - 1) / normalizedGrowthTabs);

    return Math.min(
      normalizedMaxCap,
      Math.max(normalizedMinCap, Math.round(rawCap))
    );
  }

  function normalizeSchedulerCap(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.max(0, Math.trunc(numericValue));
  }

  globalThis.ZeroLatencyPreloadSchedulerCapAllocation = {
    resolveAsymptoticPreloadCap,
    normalizeSchedulerCap,
  };
})();
