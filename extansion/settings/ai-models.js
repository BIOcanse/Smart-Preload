(() => {
  const MAX_VISIBLE_MODEL_OPTIONS = 80;
  const BASIC_MODEL_HINTS = [
    "flash",
    "mini",
    "lite",
    "nano",
    "haiku",
    "small",
    "tiny",
    "fast",
    "cheap",
    "free",
  ];
  const NON_TEXT_MODEL_HINTS = [
    "audio",
    "embedding",
    "guard",
    "image",
    "moderation",
    "rerank",
    "safeguard",
    "speech",
    "tts",
    "vision",
    "whisper",
  ];
  const HEAVY_MODEL_HINTS = [
    "max",
    "opus",
    "pro",
    "reasoner",
    "reasoning",
    "sonnet",
    "thinking",
  ];

  async function loadProviderModelOptions({
    providerId,
    provider,
    endpointUrl,
    apiKey,
    signal,
  }) {
    const catalogModels = getCatalogModels(providerId);

    if (isLmStudioProvider(providerId)) {
      return loadLmStudioModelOptions({ signal });
    }

    if (!apiKey && provider?.apiKeyOptional !== true) {
      return {
        status: "missing-key",
        models: [],
        message: "Enter an API key to load supported models.",
      };
    }

    const request = buildModelsRequest(providerId, endpointUrl, apiKey);

    if (!request) {
      return {
        status: "catalog",
        models: filterAndSortBasicModels(catalogModels, providerId, catalogModels),
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
      const models = filterAndSortBasicModels(remoteModels, providerId, catalogModels);

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
        models: filterAndSortBasicModels(catalogModels, providerId, catalogModels),
        message: `Could not load provider models; showing curated presets. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  function buildModelsRequest(providerId, endpointUrl, apiKey) {
    if (isLmStudioProvider(providerId)) {
      return null;
    }

    if (providerId === "gemini") {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
      return {
        url: url.href,
        headers: {},
      };
    }

    if (providerId === "anthropic" || providerId === "claude") {
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      };
    }

    const modelsUrl =
      providerId === "openrouter"
        ? "https://openrouter.ai/api/v1/models"
        : deriveOpenAiCompatibleModelsUrl(endpointUrl);

    if (!modelsUrl) {
      return null;
    }

    const headers = {};

    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return {
      url: modelsUrl,
      headers,
    };
  }

  function deriveOpenAiCompatibleModelsUrl(endpointUrl) {
    if (typeof endpointUrl !== "string" || !endpointUrl.trim()) {
      return null;
    }

    try {
      const url = new URL(endpointUrl);
      url.pathname = url.pathname
        .replace(/\/chat\/completions\/?$/u, "/models")
        .replace(/\/messages\/?$/u, "/models")
        .replace(/\/generateContent\/?$/u, "/models");
      url.search = "";
      return url.href;
    } catch (_error) {
      return null;
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

    if (isLmStudioProvider(providerId)) {
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

  function filterAndSortBasicModels(models, providerId, catalogModels = []) {
    if (isLmStudioProvider(providerId)) {
      return filterAndSortLmStudioModels(models);
    }

    const catalogRankById = new Map(
      catalogModels.map((model, index) => [model.id, index])
    );
    const uniqueModels = [];
    const seenModelIds = new Set();

    for (const model of Array.isArray(models) ? models : []) {
      if (!model?.id || seenModelIds.has(model.id)) {
        continue;
      }

      if (!isBasicModel(model, providerId, catalogRankById)) {
        continue;
      }

      seenModelIds.add(model.id);
      uniqueModels.push(model);
    }

    return uniqueModels
      .sort((left, right) => {
        const leftRank = catalogRankById.has(left.id)
          ? catalogRankById.get(left.id)
          : Number.MAX_SAFE_INTEGER;
        const rightRank = catalogRankById.has(right.id)
          ? catalogRankById.get(right.id)
          : Number.MAX_SAFE_INTEGER;

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return String(left.label || left.id).localeCompare(String(right.label || right.id));
      })
      .slice(0, MAX_VISIBLE_MODEL_OPTIONS);
  }

  function isBasicModel(model, providerId, catalogRankById) {
    const text = `${model.id || ""} ${model.label || ""}`.toLowerCase();

    if (!text.trim()) {
      return false;
    }

    if (NON_TEXT_MODEL_HINTS.some((hint) => text.includes(hint))) {
      return false;
    }

    const hasBasicHint = BASIC_MODEL_HINTS.some((hint) => text.includes(hint));
    const hasHeavyHint = HEAVY_MODEL_HINTS.some((hint) => text.includes(hint));

    if (hasHeavyHint && !hasBasicHint) {
      return false;
    }

    if (catalogRankById.has(model.id) && hasBasicHint) {
      return true;
    }

    if (providerId === "deepseek" && text.includes("deepseek-chat")) {
      return true;
    }

    if (hasBasicHint) {
      return true;
    }

    const sizeMatch = text.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)(b|m)(?:[^a-z]|$)/u);

    if (!sizeMatch) {
      return false;
    }

    const size = Number(sizeMatch[1]);
    const unit = sizeMatch[2];

    return unit === "m" || (unit === "b" && size <= 14);
  }

  function getCatalogModels(providerId) {
    const settingsApi = globalThis.ZeroLatencySettings;

    if (typeof settingsApi?.getAiProviderModels === "function") {
      return settingsApi.getAiProviderModels(providerId);
    }

    return [];
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
      const models = filterAndSortLmStudioModels(
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

  function filterAndSortLmStudioModels(models) {
    const seenModelIds = new Set();
    const uniqueModels = [];

    for (const model of Array.isArray(models) ? models : []) {
      if (!model?.id || seenModelIds.has(model.id)) {
        continue;
      }

      seenModelIds.add(model.id);
      uniqueModels.push({
        ...model,
        label: model.label || model.id,
        statusLabel: model.statusLabel || (model.loaded ? "loaded" : "not loaded"),
      });
    }

    return uniqueModels
      .sort((left, right) => {
        if (left.loaded !== right.loaded) {
          return left.loaded ? -1 : 1;
        }

        return String(left.label || left.id).localeCompare(String(right.label || right.id));
      })
      .slice(0, MAX_VISIBLE_MODEL_OPTIONS);
  }

  function isLmStudioProvider(providerId) {
    return (
      globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
      String(providerId || "").toLowerCase() === "lmstudio"
    );
  }

  globalThis.ZeroLatencySettingsAiModels = {
    loadProviderModelOptions,
    filterAndSortBasicModels,
  };
})();
