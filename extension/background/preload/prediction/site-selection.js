async function applySiteSelectionToPreloadCandidatePool(candidatePool, context = {}) {
  const normalizedCandidatePool = Array.isArray(candidatePool) ? candidatePool : [];

  if (normalizedCandidatePool.length === 0) {
    return [];
  }

  const selectionCandidatePool = normalizedCandidatePool.filter(
    (candidate) => !candidate?.bookmarkPreload
  );

  if (selectionCandidatePool.length === 0) {
    return [];
  }

  const settings = context?.settings ?? null;
  const ignoreConfiguredSourceSlotCaps =
    context?.ignoreConfiguredSourceSlotCaps === true;
  const nativePageSlotLimit = resolveNativePageSlotLimit(
    settings,
    context?.slotLimits?.nativePageSlotLimit,
    { ignoreConfiguredSourceSlotCaps }
  );
  const tabPageSlotLimit = resolveTabPageSlotLimit(
    settings,
    context?.slotLimits?.tabPageSlotLimit,
    { ignoreConfiguredSourceSlotCaps }
  );
  const getAiInterestContext = createSharedAiInterestContextLoader(context);
  const groupedCandidatePools = buildPreloadCandidateSiteSelectionGroups(
    selectionCandidatePool,
    settings
  );
  const [selectedNativeCandidates, selectedTabCandidates] = await Promise.all([
    applySiteSelectionToCandidateGroup(groupedCandidatePools.nativeCandidates, context, {
      pageSlotLimit: nativePageSlotLimit,
      siteSelectionLimit: resolveNativeSiteSelectionLimit(settings, nativePageSlotLimit),
      selectionGroup: "native",
      getAiInterestContext,
    }),
    applySiteSelectionToCandidateGroup(groupedCandidatePools.tabCandidates, context, {
      pageSlotLimit: tabPageSlotLimit,
      siteSelectionLimit: resolveTabSiteSelectionLimit(settings, tabPageSlotLimit),
      selectionGroup: "tab",
      getAiInterestContext,
    }),
  ]);

  return [...selectedNativeCandidates, ...selectedTabCandidates].sort(
    comparePreloadCandidatePriority
  );
}

function createSharedAiInterestContextLoader(context) {
  let aiInterestContextPromise = null;

  return async function getAiInterestContext() {
    if (aiInterestContextPromise === null) {
      aiInterestContextPromise = getAiInterestKeywordsForPreloading(context);
    }

    return aiInterestContextPromise;
  };
}

function buildPreloadCandidateSiteSelectionGroups(candidatePool, settings) {
  const nativeCandidates = [];
  const tabCandidates = [];

  for (const candidate of Array.isArray(candidatePool) ? candidatePool : []) {
    const selectionGroup = resolveCandidateSiteSelectionGroup(candidate, settings);

    if (selectionGroup === "tab") {
      tabCandidates.push(candidate);
      continue;
    }

    nativeCandidates.push(candidate);
  }

  return {
    nativeCandidates,
    tabCandidates,
  };
}

function resolveCandidateSiteSelectionGroup(candidate, settings) {
  const strategy =
    typeof candidate?.strategy === "string"
      ? candidate.strategy
      : determinePreloadStrategy(candidate, settings);

  return strategy === "hidden-tab" ? "tab" : "native";
}

async function applySiteSelectionToCandidateGroup(candidatePool, context = {}, options = {}) {
  const normalizedCandidatePool = Array.isArray(candidatePool) ? candidatePool : [];

  if (normalizedCandidatePool.length === 0) {
    return [];
  }

  const pageSlotLimit = Number(options?.pageSlotLimit);
  const crossSiteCandidates = normalizedCandidatePool.filter((candidate) => !candidate?.isSameSite);

  if (crossSiteCandidates.length === 0) {
    return [...normalizedCandidatePool]
      .sort(comparePreloadCandidatePriority)
      .slice(0, pageSlotLimit);
  }

  const siteClusters = buildCrossSiteCandidateSiteClusters(crossSiteCandidates);

  if (siteClusters.length === 0) {
    return applySiteSelectionToCandidateGroupFallback(
      normalizedCandidatePool,
      options,
      siteClusters,
      new Map()
    );
  }

  const aiKeywordMultipliersByNodeId = await buildSiteAiKeywordMultipliersByNodeId(
    siteClusters,
    {
      ...context,
      getAiInterestContext: options?.getAiInterestContext ?? null,
    }
  );
  const wasmSelectedCandidates = await trySelectPreloadCandidateGroupWithEngine(
    normalizedCandidatePool,
    options,
    aiKeywordMultipliersByNodeId
  );

  if (wasmSelectedCandidates) {
    return wasmSelectedCandidates;
  }

  return applySiteSelectionToCandidateGroupFallback(
    normalizedCandidatePool,
    options,
    siteClusters,
    aiKeywordMultipliersByNodeId
  );
}
