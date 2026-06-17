(() => {
  const providerTools = globalThis.ZeroLatencySettingsAiModelProvider;
  const modelFilters = globalThis.ZeroLatencySettingsAiModelFilters;

  async function loadProviderModelOptions({
    providerId,
    provider,
    endpointUrl,
    apiKey,
    signal,
  }) {
    const catalogModels = modelFilters.getCatalogModels(providerId);

    if (providerTools.isLmStudioProvider(providerId)) {
      return loadLmStudioModelOptions({ signal });
    }

    if (!apiKey && provider?.apiKeyOptional !== true) {
      return {
        status: "missing-key",
        models: [],
        message: "Enter an API key to load supported models.",
      };
    }

    const request = providerTools.buildModelsRequest(providerId, endpointUrl, apiKey);

    if (!request) {
      return {
        status: "catalog",
        models: modelFilters.filterAndSortBasicModels(catalogModels, providerId, catalogModels),
        message: "Model listing is not available for this provider.",
      };
    }

    try {
      const response = await fetch(request.url, {
        method: "GET",
        headers: request.headers,
        signal,
      });
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 200)}`);
      }

      const parsed = responseText ? JSON.parse(responseText) : {};
      const remoteModels = normalizeModelListResponse(providerId, parsed);
      const models = modelFilters.filterAndSortBasicModels(
        remoteModels,
        providerId,
        catalogModels
      );

      return {
        status: models.length > 0 ? "remote" : "remote-empty",
        models,
        message:
          models.length > 0
            ? "Loaded models supported by the current key."
            : "No lightweight models were returned by this provider.",
      };
    } catch (error) {
      return {
        status: "fallback",
        models: modelFilters.filterAndSortBasicModels(catalogModels, providerId, catalogModels),
        message: `Could not load provider models; showing curated presets. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
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
      return {
        status: "offline",
        models: [],
        message: `LM Studio is unavailable. Start its local server first. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  globalThis.ZeroLatencySettingsAiModels = {
    loadProviderModelOptions,
    filterAndSortBasicModels: modelFilters.filterAndSortBasicModels,
    isLmStudioProvider: providerTools.isLmStudioProvider,
  };
})();
