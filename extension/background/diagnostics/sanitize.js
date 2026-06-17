function sanitizeSettingsForDiagnostics(settings) {
  const sanitizedSettings = sanitizeDiagnosticPayload(settings);
  const aiPrediction = sanitizedSettings?.preloading?.aiPrediction;
  const rawApiKeys = settings?.preloading?.aiPrediction?.apiKeys;

  if (aiPrediction && typeof aiPrediction === "object") {
    aiPrediction.apiKeys = sanitizeApiKeyMap(rawApiKeys);
  }

  return sanitizedSettings;
}

function sanitizeApiKeyMap(apiKeys) {
  if (!apiKeys || typeof apiKeys !== "object" || Array.isArray(apiKeys)) {
    return {};
  }

  const sanitizedApiKeys = {};

  for (const [providerId, apiKey] of Object.entries(apiKeys)) {
    sanitizedApiKeys[providerId] = typeof apiKey === "string" && apiKey.trim() ? "[redacted]" : "";
  }

  return sanitizedApiKeys;
}

function normalizeEventCategory(eventName) {
  const [category] = String(eventName || "").split(".");
  return category || "unknown";
}

function normalizeLevel(value) {
  return ["debug", "info", "warn", "error"].includes(value) ? value : "info";
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value ? value : null;
}

function normalizeOptionalInteger(value) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue)) {
    return null;
  }

  return numericValue;
}

function sanitizeDiagnosticPayload(value, depth = 0) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 4_000 ? `${value.slice(0, 4_000)}...[truncated]` : value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (depth >= 6) {
    return "[truncated]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => sanitizeDiagnosticPayload(entry, depth + 1));
  }

  if (typeof value === "object") {
    const normalizedObject = {};

    for (const [key, entryValue] of Object.entries(value).slice(0, 80)) {
      if (typeof entryValue === "function" || typeof entryValue === "undefined") {
        continue;
      }

      if (/apiKey|authorization|password|token/i.test(key)) {
        normalizedObject[key] = "[redacted]";
        continue;
      }

      normalizedObject[key] = sanitizeDiagnosticPayload(entryValue, depth + 1);
    }

    return normalizedObject;
  }

  return String(value);
}

globalThis.ZeroLatencyDiagnosticSanitizer = {
  sanitizeSettingsForDiagnostics,
  sanitizeApiKeyMap,
  normalizeEventCategory,
  normalizeLevel,
  normalizeOptionalString,
  normalizeOptionalInteger,
  sanitizeDiagnosticPayload,
};
