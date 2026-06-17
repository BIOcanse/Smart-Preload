function buildLinkCandidatePoolByUrl({
  sourceNodeId,
  sourceUrl,
  graph,
  settings,
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
      settings,
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
  settings,
  sourcePageUrl,
  transitionWindowKey,
}) {
  const candidateUrl = normalizeNavigableUrl(candidate?.url, sourceUrl);

  if (!candidateUrl || candidateUrl === sourceUrl || isExcludedTrackingPage(candidateUrl)) {
    return null;
  }

  const realPreloadSafety =
    globalThis.ZeroLatencyPreloadSafetyPolicy?.inspectPreloadCandidate?.(
      {
        ...candidate,
        url: candidateUrl,
      },
      candidateUrl,
      settings
    ) ?? null;

  if (realPreloadSafety?.skipPreload === true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload.safety.skip-candidate", {
      sourceUrl,
      targetUrl: candidateUrl,
      reason: realPreloadSafety.reason || "unsafe-preload-candidate",
      reasons: realPreloadSafety.reasons || [],
    });
    return null;
  }

  if (
    globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadCandidate?.(
      candidateUrl,
      settings
    ) === true
  ) {
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
    realPreloadSafety,
  };
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
