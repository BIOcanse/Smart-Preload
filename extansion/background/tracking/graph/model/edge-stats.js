function normalizeEdgeRecord(graph, edgeId, edge) {
  if (!isPlainObject(edge)) {
    graph.edges[edgeId] = edge = {};
  }

  edge.edgeId = edge.edgeId || edgeId;
  edge.fromNodeId = edge.fromNodeId || edgeId.split(" -> ")[0] || "";
  edge.toNodeId = edge.toNodeId || edgeId.split(" -> ")[1] || "";
  edge.fromHost = edge.fromHost || graph.nodes[edge.fromNodeId]?.host || edge.fromNodeId;
  edge.toHost = edge.toHost || graph.nodes[edge.toNodeId]?.host || edge.toNodeId;
  edge.count = clampNonNegativeInt(edge.count ?? edge.transitionStats?.total, 0);
  edge.firstSeenAt =
    typeof edge.firstSeenAt === "string" ? edge.firstSeenAt : edge.lastSeenAt || null;
  edge.lastSeenAt =
    typeof edge.lastSeenAt === "string" ? edge.lastSeenAt : edge.firstSeenAt || null;
  edge.lastTransitionType =
    typeof edge.lastTransitionType === "string" ? edge.lastTransitionType : "unknown";

  const seededDailyCounts = isPlainObject(edge.dailyCounts)
    ? edge.dailyCounts
    : seedLegacyEdgeDailyCounts(edge);
  edge.dailyCounts = normalizeDailyCounts(seededDailyCounts);
  recalculateEdgeTransitionStats(
    edge,
    edge.lastSeenAt || edge.firstSeenAt || new Date().toISOString()
  );
}

function seedLegacyEdgeDailyCounts(edge) {
  if (!edge.count) {
    return {};
  }

  return {
    [buildUtcDayKey(edge.lastSeenAt || edge.firstSeenAt || new Date().toISOString())]: edge.count,
  };
}

function normalizeDailyCounts(rawDailyCounts) {
  const nextDailyCounts = {};

  for (const [dayKey, count] of Object.entries(rawDailyCounts)) {
    const normalizedCount = clampNonNegativeInt(count, 0);

    if (!isValidDayKey(dayKey) || normalizedCount <= 0) {
      continue;
    }

    nextDailyCounts[dayKey] = normalizedCount;
  }

  return nextDailyCounts;
}

function recalculateEdgeTransitionStats(edge, referenceOccurredAt) {
  const referenceDay = dayKeyToEpochDay(buildUtcDayKey(referenceOccurredAt));
  const nextDailyCounts = {};
  const nextStats = createEmptyTransitionStats();

  nextStats.total = clampNonNegativeInt(edge.count, 0);

  for (const [dayKey, count] of Object.entries(edge.dailyCounts || {})) {
    const normalizedCount = clampNonNegativeInt(count, 0);
    const dayNumber = dayKeyToEpochDay(dayKey);

    if (normalizedCount <= 0 || dayNumber === null) {
      continue;
    }

    const ageInDays = Math.max(0, referenceDay - dayNumber);

    if (ageInDays <= 364) {
      nextDailyCounts[dayKey] = normalizedCount;
      nextStats.last365d += normalizedCount;
    }

    if (ageInDays <= 29) {
      nextStats.last30d += normalizedCount;
    }

    if (ageInDays <= 6) {
      nextStats.last7d += normalizedCount;
    }

    if (ageInDays === 0) {
      nextStats.last1d += normalizedCount;
    }
  }

  edge.dailyCounts = nextDailyCounts;
  edge.transitionStats = nextStats;
}

function getEdgeTotalCount(edge) {
  return clampNonNegativeInt(edge?.transitionStats?.total ?? edge?.count, 0);
}

function buildUtcDayKey(occurredAt) {
  if (typeof occurredAt === "string" && isValidDayKey(occurredAt.slice(0, 10))) {
    return occurredAt.slice(0, 10);
  }

  const parsed = new Date(occurredAt || Date.now());
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function isValidDayKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayKeyToEpochDay(dayKey) {
  if (!isValidDayKey(dayKey)) {
    return null;
  }

  const [year, month, day] = dayKey.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function clampKeywordScore(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue));
}
