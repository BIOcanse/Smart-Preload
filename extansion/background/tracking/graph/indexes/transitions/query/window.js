function getTransitionWindowCount(edge, windowKey) {
  if (windowKey === "total") {
    return getEdgeTotalCount(edge);
  }

  return clampNonNegativeInt(edge?.transitionStats?.[windowKey], 0);
}

function getTransitionWindowMatchingDayKeys(graph, windowKey) {
  if (windowKey === "total") {
    return Object.keys(graph.transitionBuckets?.byDay || {});
  }

  const maxAgeDays = getTransitionWindowMaxAgeDays(windowKey);
  const referenceDay = dayKeyToEpochDay(buildUtcDayKey(new Date().toISOString()));

  if (maxAgeDays === null || referenceDay === null) {
    return [];
  }

  return Object.keys(graph.transitionBuckets?.byDay || {}).filter((dayKey) => {
    const dayNumber = dayKeyToEpochDay(dayKey);

    if (dayNumber === null) {
      return false;
    }

    return Math.max(0, referenceDay - dayNumber) <= maxAgeDays;
  });
}

function getTransitionWindowMaxAgeDays(windowKey) {
  switch (windowKey) {
    case "last365d":
      return 364;
    case "last30d":
      return 29;
    case "last7d":
      return 6;
    case "last1d":
      return 0;
    default:
      return null;
  }
}
