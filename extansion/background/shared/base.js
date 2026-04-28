const PENDING_SOURCE_TTL_MS = 15_000;

function clampNonNegativeInt(value, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.round(numericValue));
}

function clampNonNegativeNumber(value, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, numericValue);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePositiveInteger(value, fallback = null) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

function normalizePositiveFiniteNumber(value, fallback = null) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  return numericValue;
}

function toIsoTimestamp(timeStamp) {
  return new Date(timeStamp).toISOString();
}

function isIsoTimestampStale(timestamp, ttlMs, referenceTime = Date.now()) {
  if (typeof timestamp !== "string" || !Number.isFinite(Number(ttlMs)) || ttlMs <= 0) {
    return true;
  }

  const parsedTimestamp = Date.parse(timestamp);

  if (Number.isNaN(parsedTimestamp)) {
    return true;
  }

  return referenceTime - parsedTimestamp > ttlMs;
}
