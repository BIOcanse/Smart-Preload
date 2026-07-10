(() => {
  const providerTools = globalThis.ZeroLatencySettingsAiModelProvider;
  const modelFilters = globalThis.ZeroLatencySettingsAiModelFilters;
  const MODEL_OPTIONS_REQUEST_TIMEOUT_MS = 20_000;
  const MODEL_OPTIONS_CACHE_TTL_MS = 30_000;
  const MODEL_OPTIONS_TRANSIENT_CACHE_TTL_MS = 5_000;
  const MODEL_OPTIONS_CACHE_MAX_ENTRIES = 20;
  const modelOptionsCache = new Map();

  async function loadProviderModelOptions({
    providerId,
    provider,
    endpointUrl,
    apiKey,
    signal,
    timeoutMs = MODEL_OPTIONS_REQUEST_TIMEOUT_MS,
  }) {
    throwIfAborted(signal);

    const cacheKey = buildCacheKey(providerId, endpointUrl, apiKey);
    const cached = readCachedResult(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await loadUncachedProviderModelOptions({
      providerId,
      provider,
      endpointUrl,
      apiKey,
      signal,
      timeoutMs: normalizeRequestTimeout(timeoutMs),
    });

    throwIfAborted(signal);
    cacheResult(cacheKey, result, providerId);
    return cloneResult(result);
  }

  async function loadUncachedProviderModelOptions({
    providerId,
    provider,
    endpointUrl,
    apiKey,
    signal,
    timeoutMs,
  }) {
    const catalogModels = modelFilters.getCatalogModels(providerId);

    if (providerTools.isLmStudioProvider(providerId)) {
      return await loadLmStudioModelOptions({ signal });
    }

    if (!apiKey && provider?.apiKeyOptional !== true) {
      return {
        status: "missing-key",
        models: [],
        message: "Enter an API key to load models.",
      };
    }

    const request = providerTools.buildModelsRequest(providerId, endpointUrl, apiKey);

    if (!request) {
      return {
        status: "catalog",
        models: modelFilters.filterAndSortProviderModels(catalogModels, providerId, catalogModels),
        message: "Model listing is not available for this provider.",
      };
    }

    const requestLifetime = createRequestLifetime(signal, timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: "GET",
        headers: request.headers,
        signal: requestLifetime.signal,
      });
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 200)}`);
      }

      const parsed = responseText ? JSON.parse(responseText) : {};
      const remoteModels = normalizeModelListResponse(providerId, parsed);
      const models = modelFilters.filterAndSortProviderModels(
        remoteModels,
        providerId,
        catalogModels
      );

      return {
        status: models.length > 0 ? "remote" : "remote-empty",
        models,
        message:
          models.length > 0
            ? "Loaded models available to the current key."
            : "No models were returned by this provider.",
      };
    } catch (error) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      if (requestLifetime.didTimeout()) {
        return {
          status: "timeout",
          timeoutMs,
          models: modelFilters.filterAndSortProviderModels(
            catalogModels,
            providerId,
            catalogModels
          ),
          message: `The model list request stopped after ${Math.ceil(
            timeoutMs / 1000
          )} seconds; curated presets are shown instead.`,
        };
      }

      if (error?.name === "AbortError") {
        throw error;
      }

      return {
        status: "fallback",
        models: modelFilters.filterAndSortProviderModels(catalogModels, providerId, catalogModels),
        message: `Could not load provider models; showing curated presets. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    } finally {
      requestLifetime.dispose();
    }
  }

  function normalizeModelListResponse(providerId, parsed) {
    const rawModels = Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.models)
        ? parsed.models
        : [];

    return rawModels
      .map((rawModel) => normalizeRemoteModel(providerId, rawModel))
      .filter(Boolean);
  }

  function normalizeRemoteModel(providerId, rawModel) {
    if (!rawModel || typeof rawModel !== "object") {
      return null;
    }

    const rawId = rawModel.id || rawModel.name || rawModel.model;
    let id = typeof rawId === "string" ? rawId.trim() : "";

    if (!id) {
      return null;
    }

    if (providerId === "gemini") {
      if (
        Array.isArray(rawModel.supportedGenerationMethods) &&
        !rawModel.supportedGenerationMethods.includes("generateContent")
      ) {
        return null;
      }

      id = id.replace(/^models\//u, "");
    }

    if (providerTools.isLmStudioProvider(providerId)) {
      const lmStudioModel = globalThis.ZeroLatencyLmStudio?.normalizeModelListResponse?.({
        models: [rawModel],
      })?.[0];

      return lmStudioModel ?? null;
    }

    return {
      id,
      label: rawModel.name || rawModel.display_name || rawModel.displayName || id,
    };
  }

  async function loadLmStudioModelOptions({ signal }) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;

    if (typeof lmStudio?.listModels !== "function") {
      return {
        status: "fallback",
        models: [],
        message: "LM Studio helper is not loaded.",
      };
    }

    try {
      const models = modelFilters.filterAndSortLmStudioModels(
        await lmStudio.listModels({ signal, timeoutMs: 5_000 })
      );

      return {
        status: models.length > 0 ? "remote" : "remote-empty",
        models,
        message:
          models.length > 0
            ? "Loaded LM Studio local models. Status is shown in parentheses."
            : "LM Studio is running, but no local LLM models were returned.",
      };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        throw createAbortError();
      }

      return {
        status: "offline",
        models: [],
        message: `LM Studio is unavailable. Start its local server first. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  function createRequestLifetime(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternalSignal = () => controller.abort();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener?.("abort", abortFromExternalSignal, { once: true });
    }

    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      dispose() {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
      },
    };
  }

  function normalizeRequestTimeout(timeoutMs) {
    const normalized = Number(timeoutMs);

    if (!Number.isFinite(normalized) || normalized <= 0) {
      return MODEL_OPTIONS_REQUEST_TIMEOUT_MS;
    }

    return Math.min(24_000, Math.max(1, Math.round(normalized)));
  }

  function buildCacheKey(providerId, endpointUrl, apiKey) {
    return JSON.stringify([
      String(providerId || ""),
      String(endpointUrl || ""),
      String(apiKey || ""),
    ]);
  }

  function readCachedResult(cacheKey) {
    const entry = modelOptionsCache.get(cacheKey);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      clearTimeout(entry.expirationTimerId);
      modelOptionsCache.delete(cacheKey);
      return null;
    }

    return {
      ...cloneResult(entry.result),
      cacheHit: true,
    };
  }

  function cacheResult(cacheKey, result, providerId) {
    if (!result || result.status === "missing-key" || result.status === "cancelled") {
      return;
    }

    const isTransient =
      providerTools.isLmStudioProvider(providerId) ||
      result.status === "fallback" ||
      result.status === "offline" ||
      result.status === "timeout";
    const ttlMs = isTransient
      ? MODEL_OPTIONS_TRANSIENT_CACHE_TTL_MS
      : MODEL_OPTIONS_CACHE_TTL_MS;
    const existing = modelOptionsCache.get(cacheKey);
    if (existing) {
      clearTimeout(existing.expirationTimerId);
      modelOptionsCache.delete(cacheKey);
    }
    pruneModelOptionsCache();

    while (modelOptionsCache.size >= MODEL_OPTIONS_CACHE_MAX_ENTRIES) {
      const oldestKey = modelOptionsCache.keys().next().value;
      const oldest = modelOptionsCache.get(oldestKey);
      clearTimeout(oldest?.expirationTimerId);
      modelOptionsCache.delete(oldestKey);
    }

    const expiresAt = Date.now() + ttlMs;
    const expirationTimerId = setTimeout(() => {
      const entry = modelOptionsCache.get(cacheKey);
      if (entry?.expiresAt === expiresAt) {
        modelOptionsCache.delete(cacheKey);
      }
    }, ttlMs);
    expirationTimerId?.unref?.();

    modelOptionsCache.set(cacheKey, {
      expiresAt,
      expirationTimerId,
      result: cloneResult(result),
    });
  }

  function pruneModelOptionsCache() {
    const now = Date.now();

    for (const [cacheKey, entry] of modelOptionsCache) {
      if (entry.expiresAt <= now) {
        clearTimeout(entry.expirationTimerId);
        modelOptionsCache.delete(cacheKey);
      }
    }
  }

  function cloneResult(result) {
    return {
      ...result,
      models: Array.isArray(result?.models)
        ? result.models.map((model) => ({ ...model }))
        : [],
    };
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw createAbortError();
    }
  }

  function createAbortError() {
    const error = new Error("The model list request was cancelled.");
    error.name = "AbortError";
    return error;
  }

  globalThis.ZeroLatencySettingsAiModels = {
    MODEL_OPTIONS_REQUEST_TIMEOUT_MS,
    MODEL_OPTIONS_CACHE_TTL_MS,
    MODEL_OPTIONS_CACHE_MAX_ENTRIES,
    loadProviderModelOptions,
    filterAndSortProviderModels: modelFilters.filterAndSortProviderModels,
    isLmStudioProvider: providerTools.isLmStudioProvider,
  };
})();
