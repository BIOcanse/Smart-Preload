async function applySiteSelectionToPreloadCandidatePool(candidatePool, context = {}) {
  const normalizedCandidatePool = Array.isArray(candidatePool) ? candidatePool : [];

  if (normalizedCandidatePool.length === 0) {
    return [];
  }

  const settings = context?.settings ?? null;
  const nativePageSlotLimit = resolveNativePageSlotLimit(settings);
  const tabPageSlotLimit = resolveTabPageSlotLimit(settings);
  const getAiInterestContext = createSharedAiInterestContextLoader(context);
  const groupedCandidatePools = buildPreloadCandidateSiteSelectionGroups(
    normalizedCandidatePool,
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
  const siteSelectionLimit = Number(options?.siteSelectionLimit);
  const selectionGroup = typeof options?.selectionGroup === "string" ? options.selectionGroup : "";
  const sameOriginCandidates = normalizedCandidatePool.filter((candidate) => candidate?.isSameOrigin);
  const crossSiteCandidates = normalizedCandidatePool.filter((candidate) => !candidate?.isSameOrigin);

  if (crossSiteCandidates.length === 0) {
    return [...normalizedCandidatePool]
      .sort(comparePreloadCandidatePriority)
      .slice(0, pageSlotLimit);
  }

  const selectedSameOriginCandidates = [...sameOriginCandidates]
    .sort(comparePreloadCandidatePriority)
    .slice(0, pageSlotLimit);
  const remainingCrossSitePageSlots = Math.max(
    0,
    pageSlotLimit - selectedSameOriginCandidates.length
  );

  if (remainingCrossSitePageSlots <= 0) {
    return selectedSameOriginCandidates;
  }

  const siteClusters = buildCrossSiteCandidateSiteClusters(crossSiteCandidates);

  if (siteClusters.length === 0) {
    return selectedSameOriginCandidates;
  }

  const aiKeywordMultipliersByNodeId = await buildSiteAiKeywordMultipliersByNodeId(
    siteClusters,
    {
      ...context,
      getAiInterestContext: options?.getAiInterestContext ?? null,
    }
  );
  const scoredSiteClusters = await scoreCrossSiteCandidateClusters(
    siteClusters,
    aiKeywordMultipliersByNodeId
  );
  const effectiveSelectedSiteCount = Math.min(
    siteSelectionLimit,
    remainingCrossSitePageSlots,
    scoredSiteClusters.length
  );
  const selectedSiteClusters = scoredSiteClusters.slice(0, effectiveSelectedSiteCount);

  if (selectedSiteClusters.length === 0) {
    return selectedSameOriginCandidates;
  }

  const totalSelectedSiteCap = selectedSiteClusters.reduce(
    (sum, siteCluster) => sum + siteCluster.cap,
    0
  );
  const allocatedPageSlotCount = Math.min(remainingCrossSitePageSlots, totalSelectedSiteCap);
  const allocations = allocateSelectedSitePageSlots(
    allocatedPageSlotCount,
    selectedSiteClusters.map((siteCluster) => siteCluster.siteWeight),
    selectedSiteClusters.map((siteCluster) => siteCluster.cap)
  );
  const selectedCrossSiteCandidates = selectedSiteClusters.flatMap((siteCluster, index) => {
    const allocatedSlots = allocations[index] ?? 0;

    if (allocatedSlots <= 0) {
      return [];
    }

    return [...siteCluster.candidates]
      .sort(comparePreloadCandidatePriority)
      .slice(0, allocatedSlots)
      .map((candidate) => ({
        ...candidate,
        siteSelection: {
          siteNodeId: siteCluster.nodeId,
          siteWeight: siteCluster.siteWeight,
          siteTransitionCount: siteCluster.siteTransitionCount,
          cap: siteCluster.cap,
          allocatedSlots,
          siteRank: index + 1,
          selectionGroup,
          aiKeywordMatch: siteCluster.siteAiKeywordMatch ?? null,
        },
      }));
  });

  return [...selectedSameOriginCandidates, ...selectedCrossSiteCandidates].sort(
    comparePreloadCandidatePriority
  );
}

function buildCrossSiteCandidateSiteClusters(crossSiteCandidates) {
  const siteClustersByNodeId = new Map();

  for (const candidate of Array.isArray(crossSiteCandidates) ? crossSiteCandidates : []) {
    const siteNodeId = typeof candidate?.nodeId === "string" ? candidate.nodeId : "";

    if (!siteNodeId) {
      continue;
    }

    let siteCluster = siteClustersByNodeId.get(siteNodeId);

    if (!siteCluster) {
      siteCluster = {
        nodeId: siteNodeId,
        candidates: [],
      };
      siteClustersByNodeId.set(siteNodeId, siteCluster);
    }

    siteCluster.candidates.push(candidate);
  }

  return [...siteClustersByNodeId.values()]
    .map((siteCluster) => finalizeCrossSiteCandidateCluster(siteCluster))
    .filter(Boolean);
}

function finalizeCrossSiteCandidateCluster(siteCluster) {
  const candidates = Array.isArray(siteCluster?.candidates) ? siteCluster.candidates : [];

  if (candidates.length === 0) {
    return null;
  }

  const pageUrlSet = new Set(
    candidates
      .map((candidate) => normalizePageUrlForIndex(candidate?.targetPageUrl || candidate?.url || ""))
      .filter(Boolean)
  );
  const siteTransitionCount = candidates.reduce(
    (maxCount, candidate) => Math.max(maxCount, Number(candidate?.siteTransitionCount) || 0),
    0
  );

  return {
    nodeId: siteCluster.nodeId,
    candidates: [...candidates].sort(comparePreloadCandidatePriority),
    cap: Math.max(1, pageUrlSet.size || candidates.length),
    siteTransitionCount,
  };
}

async function buildSiteAiKeywordMultipliersByNodeId(siteClusters, context) {
  const aiKeywordTools = globalThis.ZeroLatencyAiKeywords;
  const graph = context?.graph ?? null;

  if (!aiKeywordTools || !graph) {
    return new Map();
  }

  const aiContext =
    (typeof context?.getAiInterestContext === "function"
      ? await context.getAiInterestContext()
      : null) ?? (await getAiInterestKeywordsForPreloading(context));
  const interestKeywords = Array.isArray(aiContext?.interestKeywords)
    ? aiContext.interestKeywords
    : [];

  if (interestKeywords.length === 0) {
    return new Map();
  }

  const targetPageUrls = [];

  for (const siteCluster of siteClusters) {
    for (const candidate of siteCluster.candidates) {
      if (candidate?.targetPageUrl) {
        targetPageUrls.push(candidate.targetPageUrl);
      } else if (candidate?.url) {
        targetPageUrls.push(candidate.url);
      }
    }
  }

  const targetPageKeywordsByUrl = await queryTrackingGraphFromGraph(graph, {
    type: "get-page-keywords-batch",
    pageUrls: targetPageUrls,
  });
  const multipliersByNodeId = new Map();

  for (const siteCluster of siteClusters) {
    const siteAiKeywordMatch = aiKeywordTools.buildSiteAiKeywordMatchResult({
      interestKeywords,
      siteCandidates: siteCluster.candidates,
      targetPageKeywordsByUrl,
    });

    multipliersByNodeId.set(siteCluster.nodeId, siteAiKeywordMatch);
  }

  return multipliersByNodeId;
}

async function scoreCrossSiteCandidateClusters(siteClusters, aiKeywordMultipliersByNodeId) {
  const normalizedSiteClusters = Array.isArray(siteClusters) ? siteClusters : [];
  const scoreInputs = normalizedSiteClusters.map((siteCluster) => {
    const siteAiKeywordMatch = aiKeywordMultipliersByNodeId.get(siteCluster.nodeId) ?? null;
    const multipliers = [
      buildTransitionFrequencyScoreMultiplier(siteCluster.siteTransitionCount),
    ];

    if (siteAiKeywordMatch?.multiplier > 1) {
      multipliers.push(siteAiKeywordMatch.multiplier);
    }

    return {
      baseScore: buildPreloadCandidateBaseScore(),
      multipliers,
    };
  });
  const scoreBreakdowns = await scorePreloadCandidatesBatch(scoreInputs);

  return normalizedSiteClusters
    .map((siteCluster, index) => {
      const scoreBreakdown = scoreBreakdowns[index] ?? null;
      const normalizedScore = Number(scoreBreakdown?.normalizedScore);

      return {
        ...siteCluster,
        siteAiKeywordMatch: aiKeywordMultipliersByNodeId.get(siteCluster.nodeId) ?? null,
        siteScoreBreakdown: scoreBreakdown,
        siteWeight: Number.isFinite(normalizedScore)
          ? normalizedScore
          : buildPreloadCandidateBaseScore(),
      };
    })
    .sort(compareSiteClusterPriority);
}

function compareSiteClusterPriority(left, right) {
  if ((right?.siteWeight ?? 0) !== (left?.siteWeight ?? 0)) {
    return (right?.siteWeight ?? 0) - (left?.siteWeight ?? 0);
  }

  if ((right?.siteTransitionCount ?? 0) !== (left?.siteTransitionCount ?? 0)) {
    return (right?.siteTransitionCount ?? 0) - (left?.siteTransitionCount ?? 0);
  }

  const rightBestCandidate = right?.candidates?.[0];
  const leftBestCandidate = left?.candidates?.[0];

  if (rightBestCandidate && leftBestCandidate) {
    return comparePreloadCandidatePriority(leftBestCandidate, rightBestCandidate);
  }

  return 0;
}

function resolveNativePageSlotLimit(settings) {
  const configuredPageSlotLimit = Number(
    settings?.preloading?.effectiveNativeMaxPreloadsPerSource
  );

  return Number.isFinite(configuredPageSlotLimit)
    ? Math.max(1, Math.trunc(configuredPageSlotLimit))
    : Math.max(
        1,
        settingsApi.DEFAULT_SETTINGS.preloading.nativeMaxPreloadsPerSource ??
          settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource
      );
}

function resolveTabPageSlotLimit(settings) {
  const configuredPageSlotLimit = Number(settings?.preloading?.effectiveTabMaxPreloadsPerSource);

  return Number.isFinite(configuredPageSlotLimit)
    ? Math.max(1, Math.trunc(configuredPageSlotLimit))
    : Math.max(1, settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource);
}

function resolveNativeSiteSelectionLimit(settings, pageSlotLimit) {
  const configuredSiteSelectionLimit = Number(settings?.preloading?.effectiveSiteSelectionLimit);

  if (Number.isFinite(configuredSiteSelectionLimit)) {
    return Math.max(1, Math.trunc(configuredSiteSelectionLimit));
  }

  return pageSlotLimit;
}

function resolveTabSiteSelectionLimit(settings, pageSlotLimit) {
  const configuredSiteSelectionLimit = Number(
    settings?.preloading?.effectiveTabSiteSelectionLimit
  );

  if (Number.isFinite(configuredSiteSelectionLimit)) {
    return Math.max(1, Math.trunc(configuredSiteSelectionLimit));
  }

  return resolveNativeSiteSelectionLimit(settings, pageSlotLimit);
}

function allocateSelectedSitePageSlots(a, scores, caps, transform = (value) => Math.sqrt(value)) {
  if (!Number.isInteger(a) || a < 0) {
    throw new Error("a must be a non-negative integer");
  }

  if (
    !Array.isArray(scores) ||
    !Array.isArray(caps) ||
    scores.length === 0 ||
    scores.length !== caps.length
  ) {
    throw new Error("scores and caps must be arrays of the same non-zero length");
  }

  const n = scores.length;

  for (let index = 0; index < n; index += 1) {
    if (
      typeof scores[index] !== "number" ||
      !Number.isFinite(scores[index]) ||
      scores[index] <= 0
    ) {
      throw new Error(`scores[${index}] must be a positive finite number`);
    }

    if (!Number.isInteger(caps[index]) || caps[index] < 1) {
      throw new Error(`caps[${index}] must be an integer >= 1`);
    }
  }

  if (a < n) {
    throw new Error("No feasible solution: a is smaller than number of selected items");
  }

  const totalCap = caps.reduce((sum, value) => sum + value, 0);

  if (a > totalCap) {
    throw new Error("No feasible solution: a is greater than total capacity");
  }

  const baseline = new Array(n).fill(1);
  const remainingSlots = a - n;

  if (remainingSlots === 0) {
    return baseline;
  }

  const extraCaps = caps.map((cap) => cap - 1);
  const weights = scores.map(transform);

  for (let index = 0; index < n; index += 1) {
    if (!(weights[index] >= 0) || !Number.isFinite(weights[index])) {
      throw new Error(
        `transform(scores[${index}]) must produce a finite non-negative number`
      );
    }
  }

  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  if (totalWeight <= 0) {
    throw new Error("Total transformed weight must be positive");
  }

  const targets = weights.map((weight) => (remainingSlots * weight) / totalWeight);
  const inf = Number.POSITIVE_INFINITY;
  let previous = new Array(remainingSlots + 1).fill(inf);
  previous[0] = 0;
  const choice = Array.from({ length: n }, () => new Array(remainingSlots + 1).fill(-1));
  const parentSum = Array.from({ length: n }, () => new Array(remainingSlots + 1).fill(-1));

  for (let index = 0; index < n; index += 1) {
    const current = new Array(remainingSlots + 1).fill(inf);
    const maxExtraCap = Math.min(extraCaps[index], remainingSlots);

    for (let partialSum = 0; partialSum <= remainingSlots; partialSum += 1) {
      if (!Number.isFinite(previous[partialSum])) {
        continue;
      }

      for (
        let extraCount = 0;
        extraCount <= maxExtraCap && partialSum + extraCount <= remainingSlots;
        extraCount += 1
      ) {
        const nextSum = partialSum + extraCount;
        const cost =
          previous[partialSum] + (extraCount - targets[index]) * (extraCount - targets[index]);

        if (cost < current[nextSum]) {
          current[nextSum] = cost;
          choice[index][nextSum] = extraCount;
          parentSum[index][nextSum] = partialSum;
        }
      }
    }

    previous = current;
  }

  if (!Number.isFinite(previous[remainingSlots])) {
    throw new Error("No feasible solution exists under the constraints");
  }

  const extra = new Array(n).fill(0);
  let partialSum = remainingSlots;

  for (let index = n - 1; index >= 0; index -= 1) {
    extra[index] = choice[index][partialSum];
    partialSum = parentSum[index][partialSum];
  }

  return baseline.map((value, index) => value + extra[index]);
}
