async function selectPreloadTargets({
  currentNodeId,
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  currentPageTitle,
  currentPageTextDigest,
  currentPageContentFingerprint,
  candidateLinks,
  graph,
  settings,
  slotLimits,
  ignoreConfiguredSourceSlotCaps = false,
}) {
  const scoredCandidatePool = await buildScoredPreloadCandidatePool({
    currentNodeId,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    candidateLinks,
    graph,
    settings,
  });

  return selectPreloadTargetsFromScoredCandidatePool({
    scoredCandidatePool,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    graph,
    settings,
    slotLimits,
    ignoreConfiguredSourceSlotCaps,
  });
}

async function buildScoredPreloadCandidatePool({
  currentNodeId,
  sourceUrl,
  sourceWindowId,
  sourceTabId,
  currentPageTitle,
  currentPageTextDigest,
  currentPageContentFingerprint,
  candidateLinks,
  graph,
  settings,
}) {
  const sourceNodeId = currentNodeId || buildNodeSeed(sourceUrl).nodeId;
  const transitionWindowKey = getPreloadTransitionWindowKey(settings);

  return buildPreloadCandidatePool({
    sourceNodeId,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
    candidateLinks,
    graph,
    settings,
    transitionWindowKey,
  });
}
