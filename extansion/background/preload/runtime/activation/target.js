function resolveActivatedTrackingTargetUrl(requestedUrl, preloadedTab, entry) {
  const candidates = [preloadedTab?.url, entry?.loadedUrl, requestedUrl];

  for (const candidateUrl of candidates) {
    const normalizedCandidateUrl = normalizePageUrlForIndex(candidateUrl || "");

    if (normalizedCandidateUrl && isTrackableAndAllowedUrl(candidateUrl || "")) {
      return normalizedCandidateUrl;
    }
  }

  return requestedUrl;
}
