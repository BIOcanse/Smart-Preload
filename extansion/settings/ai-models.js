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

  function createAiModelControls({
    elements,
    warningElement,
    settingsApi,
    modelLoader = globalThis.ZeroLatencySettingsAiModels,
    translate,
    readFormSettings,
    setDraftSettings,
    updateComputedState,
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;
    let modelOptionsRequestId = 0;
    let pendingLmStudioModelLoadId = "";

    function populateProviderOptions() {
      const providerSelect = elements?.aiPredictionProvider;
      const options = Array.isArray(settingsApi?.AI_PROVIDER_OPTIONS)
        ? settingsApi.AI_PROVIDER_OPTIONS
        : [];

      if (!providerSelect) {
        return;
      }

      providerSelect.textContent = "";

      for (const optionSpec of options) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = optionSpec.label;
        providerSelect.append(option);
      }
    }

    function readFormAiPrediction(draftSettings) {
      const providerId = elements.aiPredictionProvider.value;
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ?? {};
      const providerIsLmStudio = isLmStudioProvider(providerId);
      const aiApiKeys = {
        ...(draftSettings?.preloading?.aiPrediction?.apiKeys ?? {}),
        [providerId]: providerIsLmStudio ? "" : elements.aiProviderApiKey.value.trim(),
      };
      const aiModelIds = {
        ...(draftSettings?.preloading?.aiPrediction?.modelIds ?? {}),
        [providerId]: elements.aiPredictionModel.value.trim(),
      };
      const aiEndpointUrls = {
        ...(draftSettings?.preloading?.aiPrediction?.endpointUrls ?? {}),
        [providerId]: providerIsLmStudio
          ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
          : elements.aiProviderEndpoint.value.trim(),
      };

      return {
        enabled: elements.aiPredictionEnabled.checked,
        providerId,
        modelId: aiModelIds[providerId],
        apiKeys: aiApiKeys,
        modelIds: aiModelIds,
        endpointUrls: aiEndpointUrls,
      };
    }

    function syncProviderFieldsFromSettings(settings) {
      const aiPrediction = settings?.preloading?.aiPrediction ?? {};
      const providerId = elements.aiPredictionProvider.value || aiPrediction.providerId;
      const provider =
        settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ??
        settingsApi?.AI_PROVIDER_OPTIONS?.[0] ??
        {};
      const providerIsLmStudio = isLmStudioProvider(providerId);
      const modelId =
        aiPrediction.modelIds?.[providerId] ||
        provider.defaultModelId ||
        aiPrediction.modelId ||
        "";
      const apiKey = providerIsLmStudio ? "" : aiPrediction.apiKeys?.[providerId] || "";
      const endpointUrl = providerIsLmStudio
        ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
        : aiPrediction.endpointUrls?.[providerId] || provider.endpointUrl || "";

      renderModelSelectOptions({
        providerId,
        selectedModelId: modelId,
        models: getCuratedAiModelOptions(providerId),
        disabled: !apiKey && provider.apiKeyOptional !== true,
        placeholder:
          !apiKey && provider.apiKeyOptional !== true
            ? t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models")
            : t("settingsAiLoadingModels", [], "Loading supported models..."),
      });
      elements.aiProviderApiKey.value = apiKey;
      elements.aiProviderEndpoint.value = endpointUrl;
      elements.aiProviderApiKey.disabled = providerIsLmStudio;
      elements.aiProviderEndpoint.disabled = providerIsLmStudio;
      elements.aiProviderApiKey.placeholder =
        providerIsLmStudio
          ? t("settingsAiLmStudioKeyIgnoredPlaceholder", [], "Ignored for LM Studio")
          : provider.apiKeyOptional === true
            ? t("settingsAiKeyOptionalPlaceholder", [], "Optional for local compatible endpoints")
            : t("settingsAiKeyRequiredPlaceholder", [], "Required");
      void refreshModelOptions({
        providerId,
        selectedModelId: modelId,
        apiKey,
        endpointUrl,
      });
    }

    async function refreshOptionsForCurrentProvider() {
      const providerId = String(elements.aiPredictionProvider.value || "");
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ?? {};
      const providerIsLmStudio = isLmStudioProvider(providerId);
      const selectedModelId = String(elements.aiPredictionModel.value || "").trim();
      const apiKey = providerIsLmStudio
        ? ""
        : String(elements.aiProviderApiKey.value || "").trim();
      const endpointUrl = providerIsLmStudio
        ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
        : String(elements.aiProviderEndpoint.value || "").trim();
      await refreshModelOptions({
        providerId,
        selectedModelId,
        apiKey,
        endpointUrl,
      });
    }

    async function refreshModelOptions({ providerId, selectedModelId, apiKey, endpointUrl }) {
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
      const requestId = ++modelOptionsRequestId;

      if (!provider) {
        renderModelSelectOptions({
          providerId,
          selectedModelId: "",
          models: [],
          disabled: true,
          placeholder: t("settingsAiSelectProviderFirst", [], "Select a provider first"),
        });
        return;
      }

      if (!apiKey && provider.apiKeyOptional !== true) {
        renderModelSelectOptions({
          providerId,
          selectedModelId,
          models: [],
          disabled: true,
          placeholder: t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models"),
        });
        return;
      }

      renderModelSelectOptions({
        providerId,
        selectedModelId,
        models: getCuratedAiModelOptions(providerId),
        disabled: false,
        placeholder: t("settingsAiLoadingModels", [], "Loading supported models..."),
      });

      const result = await modelLoader?.loadProviderModelOptions?.({
        providerId,
        provider,
        endpointUrl,
        apiKey,
      });

      if (requestId !== modelOptionsRequestId) {
        return;
      }

      const models = Array.isArray(result?.models)
        ? result.models
        : getCuratedAiModelOptions(providerId);
      const selectedAfterRender = renderModelSelectOptions({
        providerId,
        selectedModelId,
        models,
        disabled: models.length === 0,
        placeholder:
          models.length === 0
            ? t("settingsAiNoSupportedModels", [], "No supported lightweight models found")
            : "",
      });

      elements.aiPredictionModel.title = result?.message || "";

      if (selectedAfterRender !== selectedModelId) {
        const nextSettings = readFormSettings?.();
        if (nextSettings) {
          setDraftSettings?.(nextSettings);
          updateComputedState?.(nextSettings);
          syncMismatchWarning();
        }
      }

      if (isLmStudioProvider(providerId) && elements.aiPredictionEnabled.checked === true) {
        const settings = readFormSettings?.();
        if (settings) {
          void ensureSelectedLmStudioModelLoaded(settings);
        }
      }
    }

    function renderModelSelectOptions({
      providerId,
      selectedModelId,
      models,
      disabled,
      placeholder,
    }) {
      const normalizedModels = Array.isArray(models) ? models : [];
      const modelSelect = elements.aiPredictionModel;
      const nextSelectedModelId =
        normalizedModels.some((model) => model.id === selectedModelId)
          ? selectedModelId
          : normalizedModels[0]?.id || "";

      modelSelect.textContent = "";

      if (placeholder) {
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = placeholder;
        placeholderOption.disabled = normalizedModels.length > 0;
        placeholderOption.selected = !nextSelectedModelId;
        modelSelect.append(placeholderOption);
      }

      for (const model of normalizedModels) {
        const option = document.createElement("option");
        option.value = String(model.id || "");
        option.textContent = formatModelOptionLabel(model);
        modelSelect.append(option);
      }

      modelSelect.value = nextSelectedModelId;
      modelSelect.disabled = Boolean(disabled);
      modelSelect.dataset.providerId = providerId || "";

      return nextSelectedModelId;
    }

    function formatModelOptionLabel(model) {
      const modelId = String(model?.id || "");
      const label = String(model?.label || modelId);
      const suffixes = [];

      if (model?.statusLabel) {
        suffixes.push(String(model.statusLabel));
      }

      if (modelId && label !== modelId) {
        suffixes.push(modelId);
      }

      return suffixes.length > 0 ? `${label} (${suffixes.join(" / ")})` : label;
    }

    async function ensureSelectedLmStudioModelLoaded(settings) {
      const aiPrediction = settings?.preloading?.aiPrediction ?? {};
      const modelId = String(aiPrediction.modelId || "").trim();

      if (
        aiPrediction.enabled !== true ||
        !isLmStudioProvider(aiPrediction.providerId) ||
        !modelId ||
        pendingLmStudioModelLoadId === modelId ||
        typeof globalThis.ZeroLatencyLmStudio?.loadModel !== "function"
      ) {
        return;
      }

      pendingLmStudioModelLoadId = modelId;
      elements.aiPredictionModel.title = t(
        "settingsAiLmStudioLoadingModel",
        [modelId],
        `Loading LM Studio model: ${modelId}`
      );

      try {
        const status = await globalThis.ZeroLatencyLmStudio.getModelStatus(modelId).catch(
          () => null
        );
        let didRequestLoad = false;

        if (!status?.loaded) {
          await globalThis.ZeroLatencyLmStudio.loadModel(modelId);
          didRequestLoad = true;
          const loaded = await globalThis.ZeroLatencyLmStudio.waitForModelLoaded(modelId);

          if (loaded?.ok !== true) {
            throw new Error(loaded?.reason || "model load timed out");
          }
        }

        if (didRequestLoad) {
          await refreshOptionsForCurrentProvider();
        }
      } catch (error) {
        elements.aiPredictionModel.title = `LM Studio model load failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      } finally {
        if (pendingLmStudioModelLoadId === modelId) {
          pendingLmStudioModelLoadId = "";
        }
      }
    }

    function syncMismatchWarning() {
      if (!warningElement) {
        return;
      }

      const aiPredictionEnabled = elements.aiPredictionEnabled.checked === true;
      const providerId = String(elements.aiPredictionProvider.value || "");
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
      const providerLabel = provider?.label || providerId || t("commonProvider", [], "provider");
      const modelId = String(elements.aiPredictionModel.value || "").trim();
      const apiKey = String(elements.aiProviderApiKey.value || "").trim();
      const endpointUrl = String(elements.aiProviderEndpoint.value || "").trim();

      if (!aiPredictionEnabled) {
        warningElement.classList.add("is-hidden");
        warningElement.textContent = "";
        return;
      }

      if (!provider || !modelId || !endpointUrl || (!apiKey && provider.apiKeyOptional !== true)) {
        warningElement.textContent = t(
          "settingsAiProviderMissingWarning",
          [providerLabel],
          `AI scoring will stay disabled until ${providerLabel} has a model, endpoint, and API key.`
        );
        warningElement.classList.remove("is-hidden");
        return;
      }

      warningElement.classList.add("is-hidden");
      warningElement.textContent = "";
    }

    function getCuratedAiModelOptions(providerId) {
      return typeof settingsApi?.getAiProviderModels === "function"
        ? settingsApi.getAiProviderModels(providerId)
        : [];
    }

    return {
      populateProviderOptions,
      readFormAiPrediction,
      syncProviderFieldsFromSettings,
      refreshOptionsForCurrentProvider,
      ensureSelectedLmStudioModelLoaded,
      syncMismatchWarning,
      isLmStudioProvider,
    };
  }

  globalThis.ZeroLatencySettingsAiModels = {
    loadProviderModelOptions,
    filterAndSortBasicModels,
  };
  globalThis.ZeroLatencySettingsAiModelControls = {
    create: createAiModelControls,
  };
})();
