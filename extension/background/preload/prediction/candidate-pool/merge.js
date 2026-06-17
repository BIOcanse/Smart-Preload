function mergeCandidateIntoPool(candidatePoolByUrl, candidateUrl, nextCandidate) {
  const existingCandidate = candidatePoolByUrl.get(candidateUrl);

  candidatePoolByUrl.set(
    candidateUrl,
    existingCandidate
      ? mergeCandidatePoolEntry(existingCandidate, nextCandidate)
      : nextCandidate
  );
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
    realPreloadSafety:
      nextCandidate.realPreloadSafety ?? existingCandidate.realPreloadSafety ?? null,
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
