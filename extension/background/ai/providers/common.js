(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});

  const OPENAI_COMPATIBLE_PROVIDERS = new Set([
    "openai",
    "grok",
    "deepseek",
    "qwen",
    "glm",
    "kimi",
    "openrouter",
    "lmstudio",
  ]);
  const DEFAULT_AI_TIMEOUT_MS = 25_000;
  const MAX_AI_TIMEOUT_MS = 25_000;

  function normalizeProviderId(value) {
    const settingsApi = globalThis.ZeroLatencySettings;
    return settingsApi?.AI_PROVIDER_VALUES?.includes(value)
      ? value
      : settingsApi?.DEFAULT_SETTINGS?.preloading?.aiPrediction?.providerId || "deepseek";
  }

  function isLmStudioProvider(providerId) {
    return (
      globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
      String(providerId || "").toLowerCase() === "lmstudio"
    );
  }

  function shouldRequestJson(responseFormat, requestParams) {
    return responseFormat === "json" && requestParams?.responseFormatJson !== false;
  }

  function resolveMaxTokens(requestParams) {
    const maxTokens = Number(requestParams?.maxTokens);

    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
      return 512;
    }

    return Math.round(maxTokens);
  }

  function applyFiniteNumberParam(body, key, value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return;
    }

    body[key] = numericValue;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const requestedTimeoutMs = Number(options?.timeoutMs) || DEFAULT_AI_TIMEOUT_MS;
    const timeoutMs = Math.min(
      MAX_AI_TIMEOUT_MS,
      Math.max(1_000, requestedTimeoutMs)
    );
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  Object.assign(namespace, {
    OPENAI_COMPATIBLE_PROVIDERS,
    DEFAULT_AI_TIMEOUT_MS,
    MAX_AI_TIMEOUT_MS,
    normalizeProviderId,
    isLmStudioProvider,
    shouldRequestJson,
    resolveMaxTokens,
    applyFiniteNumberParam,
    isPlainObject,
    fetchWithTimeout,
  });
})();
