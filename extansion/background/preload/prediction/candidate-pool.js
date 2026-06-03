function getPreloadTransitionWindowKey(settings) {
  return settingsApi.normalizeTransitionWindowKey?.(
    settings?.preloading?.effectiveTransitionWindowKey,
    "total"
  ) ?? "total";
}

async function buildPreloadCandidatePool({
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
  transitionWindowKey = "total",
}) {
  const sourcePageUrl = normalizePageUrlForIndex(sourceUrl);
  const sourceCandidateLinks = Array.isArray(candidateLinks) ? candidateLinks : [];
  const candidatePoolByUrl = buildLinkCandidatePoolByUrl({
    sourceNodeId,
    sourceUrl,
    graph,
    sourcePageUrl,
    sourceCandidateLinks,
    transitionWindowKey,
  });

  const candidatePool = filterSourceSpecificCandidatePool(
    [...candidatePoolByUrl.values()],
    sourceUrl
  );

  if (candidatePool.length === 0) {
    return [];
  }

  const enrichedCandidatePool = await enrichPreloadCandidatePoolWithMetrics(candidatePool, {
    graph,
    transitionWindowKey,
    sourceNodeId,
    sourcePageUrl,
  });

  return scorePreloadCandidatePool(enrichedCandidatePool, {
    graph,
    settings,
    sourceUrl,
    sourceWindowId,
    sourceTabId,
    currentPageTitle,
    currentPageTextDigest,
    currentPageContentFingerprint,
  });
}

function buildLinkCandidatePoolByUrl({
  sourceNodeId,
  sourceUrl,
  graph,
  sourcePageUrl,
  sourceCandidateLinks,
  transitionWindowKey,
}) {
  const candidatePoolByUrl = new Map();

  for (let index = 0; index < sourceCandidateLinks.length; index += 1) {
    const nextCandidate = buildLinkPreloadCandidate({
      candidate: sourceCandidateLinks[index],
      index,
      sourceNodeId,
      sourceUrl,
      graph,
      sourcePageUrl,
      transitionWindowKey,
    });

    if (nextCandidate) {
      mergeCandidateIntoPool(candidatePoolByUrl, nextCandidate.url, nextCandidate);
    }
  }

  return candidatePoolByUrl;
}

function buildLinkPreloadCandidate({
  candidate,
  index,
  sourceNodeId,
  sourceUrl,
  graph,
  sourcePageUrl,
  transitionWindowKey,
}) {
  const candidateUrl = normalizeNavigableUrl(candidate?.url, sourceUrl);

  if (!candidateUrl || candidateUrl === sourceUrl || isExcludedGooglePage(candidateUrl)) {
    return null;
  }

  const targetNodeId = buildNodeSeed(candidateUrl).nodeId;
  const targetPageUrl = normalizePageUrlForIndex(candidateUrl);
  const visibilityScore = Number(candidate.visibility) || 0;
  const recordedTargetHint = isGoogleSearchResultsPage(sourceUrl)
    ? null
    : getRecordedLinkTargetHint(graph, sourcePageUrl, candidateUrl);

  return {
    url: candidateUrl,
    nodeId: targetNodeId,
    targetHint: recordedTargetHint ?? (candidate?.targetHint === "_blank" ? "_blank" : "_self"),
    isSameOrigin: isSameOriginUrl(sourceUrl, candidateUrl),
    isSameSite: sourceNodeId === targetNodeId,
    targetPageUrl,
    transitionWindowKey,
    visibilityScore,
    linkIndex: index,
    anchorText: typeof candidate?.anchorText === "string" ? candidate.anchorText : "",
    nearbyText: typeof candidate?.nearbyText === "string" ? candidate.nearbyText : "",
    titleAttr: typeof candidate?.titleAttr === "string" ? candidate.titleAttr : "",
    ariaLabel: typeof candidate?.ariaLabel === "string" ? candidate.ariaLabel : "",
    imageAlt: typeof candidate?.imageAlt === "string" ? candidate.imageAlt : "",
    hrefPathTokens: buildHrefPathTokens(candidateUrl),
  };
}

function mergeCandidateIntoPool(candidatePoolByUrl, candidateUrl, nextCandidate) {
  const existingCandidate = candidatePoolByUrl.get(candidateUrl);

  candidatePoolByUrl.set(
    candidateUrl,
    existingCandidate
      ? mergeCandidatePoolEntry(existingCandidate, nextCandidate)
      : nextCandidate
  );
}

async function enrichPreloadCandidatePoolWithMetrics(candidatePool, context) {
  const candidateMetricsByUrl = await getCandidateTransitionMetricsByUrl({
    graph: context.graph,
    transitionWindowKey: context.transitionWindowKey,
    sourceNodeId: context.sourceNodeId,
    sourcePageUrl: context.sourcePageUrl,
    candidatePool,
  });

  return candidatePool
    .map((candidate) =>
      enrichPreloadCandidateWithMetrics(candidate, candidateMetricsByUrl, {
        graph: context.graph,
        sourceNodeId: context.sourceNodeId,
      })
    )
    .filter(Boolean);
}

function mergeCandidatePoolEntry(existingCandidate, nextCandidate) {
  const existingCandidatePriority = buildCandidateInstancePriority(existingCandidate);
  const nextCandidatePriority = buildCandidateInstancePriority(nextCandidate);
  const dominantCandidate =
    nextCandidatePriority > existingCandidatePriority ? nextCandidate : existingCandidate;

  return {
    ...dominantCandidate,
    visibilityScore: Math.max(existingCandidate.visibilityScore, nextCandidate.visibilityScore),
    linkIndex: Math.min(existingCandidate.linkIndex, nextCandidate.linkIndex),
    anchorText: selectRicherCandidateText(existingCandidate.anchorText, nextCandidate.anchorText),
    nearbyText: selectRicherCandidateText(existingCandidate.nearbyText, nextCandidate.nearbyText),
    titleAttr: selectRicherCandidateText(existingCandidate.titleAttr, nextCandidate.titleAttr),
    ariaLabel: selectRicherCandidateText(existingCandidate.ariaLabel, nextCandidate.ariaLabel),
    imageAlt: selectRicherCandidateText(existingCandidate.imageAlt, nextCandidate.imageAlt),
    extraScoreMultipliers: mergeCandidateScoreMultipliers(
      existingCandidate.extraScoreMultipliers,
      nextCandidate.extraScoreMultipliers
    ),
  };
}

function mergeCandidateScoreMultipliers(existingMultipliers, nextMultipliers) {
  return [
    ...(Array.isArray(existingMultipliers) ? existingMultipliers : []),
    ...(Array.isArray(nextMultipliers) ? nextMultipliers : []),
  ].filter((value) => Number.isFinite(Number(value)));
}

function buildCandidateInstancePriority(candidate) {
  const visibilityScore = Number(candidate?.visibilityScore) || 0;
  const textualWeight =
    String(candidate?.anchorText || "").trim().length * 4 +
    String(candidate?.nearbyText || "").trim().length * 2 +
    String(candidate?.titleAttr || "").trim().length +
    String(candidate?.ariaLabel || "").trim().length +
    String(candidate?.imageAlt || "").trim().length;
  const linkIndex = Number.isFinite(Number(candidate?.linkIndex))
    ? Math.max(0, Math.trunc(Number(candidate.linkIndex)))
    : 999999;

  return visibilityScore * 10000 + textualWeight - linkIndex;
}

function selectRicherCandidateText(previousValue, nextValue) {
  const normalizedPreviousValue = String(previousValue || "").trim();
  const normalizedNextValue = String(nextValue || "").trim();

  if (!normalizedPreviousValue) {
    return normalizedNextValue;
  }

  if (!normalizedNextValue) {
    return normalizedPreviousValue;
  }

  return normalizedNextValue.length > normalizedPreviousValue.length
    ? normalizedNextValue
    : normalizedPreviousValue;
}

function buildHrefPathTokens(targetUrl) {
  try {
    return decodeURIComponent(new URL(targetUrl).pathname)
      .split("/")
      .map((token) => String(token || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  } catch (_error) {
    return [];
  }
}

function filterSourceSpecificCandidatePool(candidatePool, sourceUrl) {
  const normalizedCandidatePool = Array.isArray(candidatePool) ? candidatePool : [];

  if (!isGoogleSearchResultsPage(sourceUrl)) {
    return normalizedCandidatePool;
  }

  const crossSiteCandidates = normalizedCandidatePool.filter(
    (candidate) => candidate?.isSameOrigin !== true
  );

  return crossSiteCandidates.length > 0 ? crossSiteCandidates : normalizedCandidatePool;
}

function isGoogleSearchResultsPage(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    const isGoogleHost =
      hostname === "google.com" ||
      hostname === "www.google.com" ||
      hostname.startsWith("google.") ||
      hostname.startsWith("www.google.");

    return isGoogleHost && parsedUrl.pathname === "/search" && parsedUrl.searchParams.has("q");
  } catch (_error) {
    return false;
  }
}
