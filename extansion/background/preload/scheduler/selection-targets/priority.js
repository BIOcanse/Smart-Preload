function compareStoredSelectionTargetPriority(left, right) {
  if (isIndependentBookmarkPreloadTarget(left) && isIndependentBookmarkPreloadTarget(right)) {
    const rankDelta =
      clampNonNegativeInt(left?.bookmarkPreload?.rank, 0) -
      clampNonNegativeInt(right?.bookmarkPreload?.rank, 0);

    if (rankDelta !== 0) {
      return rankDelta;
    }
  }

  const scoreDelta = (Number(right?.score) || 0) - (Number(left?.score) || 0);

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const leftUrl = String(left?.url || "");
  const rightUrl = String(right?.url || "");
  return leftUrl.localeCompare(rightUrl);
}

function isIndependentBookmarkPreloadTarget(target) {
  return Boolean(target?.bookmarkPreload);
}
