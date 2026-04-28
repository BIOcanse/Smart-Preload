async function queryTrackingGraph(state, query) {
  const engine = await getVisitGraphEngine();

  if (!engine) {
    return queryTrackingGraphFallback(state, query);
  }

  try {
    return engine.queryState(sanitizeTrackingStateForWasm(state), query);
  } catch (error) {
    console.error("Wasm visit graph query failed, falling back to JS.", error);
    return queryTrackingGraphFallback(state, query);
  }
}

async function queryTrackingGraphFromGraph(graph, query) {
  return queryTrackingGraph(
    {
      graph,
      tabState: {},
      pendingSources: {},
    },
    query
  );
}

const SCORE_NORMALIZATION_MULTIPLIER_SCALE = 0.7;

async function scorePreloadCandidate(baseScore, multipliers = []) {
  const engine = await getVisitGraphEngine();

  if (!engine) {
    return scoreWeightsFallback(baseScore, multipliers);
  }

  try {
    return engine.scoreWeights(baseScore, multipliers);
  } catch (error) {
    console.error("Wasm preload scoring failed, falling back to JS.", error);
    return scoreWeightsFallback(baseScore, multipliers);
  }
}

async function scorePreloadCandidatesBatch(inputs = []) {
  const normalizedInputs = Array.isArray(inputs) ? inputs : [];
  const engine = await getVisitGraphEngine();

  if (!engine) {
    return normalizedInputs.map((input) =>
      scoreWeightsFallback(input?.baseScore, input?.multipliers)
    );
  }

  try {
    return engine.scoreWeightsBatch(normalizedInputs);
  } catch (error) {
    console.error("Wasm preload scoring batch failed, falling back to JS.", error);
    return normalizedInputs.map((input) =>
      scoreWeightsFallback(input?.baseScore, input?.multipliers)
    );
  }
}

async function filterPreloadCandidateMetrics(input) {
  const engine = await getVisitGraphEngine();

  if (!engine || typeof engine.filterCandidateMetrics !== "function") {
    return null;
  }

  try {
    return engine.filterCandidateMetrics(input);
  } catch (error) {
    console.error("Wasm preload candidate filter failed, falling back to JS.", error);
    return null;
  }
}

function scoreWeightsFallback(baseScore, multipliers = []) {
  const sanitizedBaseScore = sanitizeScoreWeight(baseScore, 0);
  const sanitizedMultipliers = Array.isArray(multipliers)
    ? multipliers
        .filter((multiplier) => Number.isFinite(Number(multiplier)))
        .map((multiplier) => sanitizeScoreWeight(multiplier, 1))
    : [];
  const effectiveMultiplierCount = sanitizedMultipliers.filter(
    (multiplier) => Math.abs(multiplier - 1) > Number.EPSILON
  ).length;
  const combinedScore = sanitizedMultipliers.reduce(
    (score, multiplier) => score * multiplier,
    sanitizedBaseScore
  );
  const normalizedScore =
    effectiveMultiplierCount === 0 || combinedScore <= 0
      ? combinedScore
      : combinedScore ** (1 / (SCORE_NORMALIZATION_MULTIPLIER_SCALE * effectiveMultiplierCount));

  return {
    baseScore: sanitizedBaseScore,
    combinedScore,
    normalizedScore,
    effectiveMultiplierCount,
    multipliers: sanitizedMultipliers,
  };
}

function sanitizeScoreWeight(value, fallback) {
  const normalizedValue = Number(value);

  if (!Number.isFinite(normalizedValue)) {
    return fallback;
  }

  return Math.max(0, normalizedValue);
}
