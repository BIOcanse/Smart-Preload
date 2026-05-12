(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const {
    OPENAI_COMPATIBLE_PROVIDERS,
    normalizeProviderId,
    isLmStudioProvider,
    shouldRequestJson,
    resolveMaxTokens,
    applyFiniteNumberParam,
    isPlainObject,
  } = namespace;

  function buildAiProviderRequest(settings, prompt, options = {}) {
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    const settingsApi = globalThis.ZeroLatencySettings;
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};
    const providerId = normalizeProviderId(aiPrediction.providerId);
    const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
    const modelId =
      typeof aiPrediction.modelId === "string" && aiPrediction.modelId.trim()
        ? aiPrediction.modelId.trim()
        : typeof aiPrediction.modelIds?.[providerId] === "string"
          ? aiPrediction.modelIds[providerId].trim()
          : "";
    const endpointUrl =
      typeof aiPrediction.endpointUrls?.[providerId] === "string"
        ? aiPrediction.endpointUrls[providerId].trim()
        : provider?.endpointUrl || "";
    const apiKey =
      typeof aiPrediction.apiKeys?.[providerId] === "string"
        ? aiPrediction.apiKeys[providerId].trim()
        : "";
    const modelInfo =
      typeof settingsApi?.getAiModelInfo === "function"
        ? settingsApi.getAiModelInfo(providerId, modelId)
        : null;
    const requestParams =
      typeof settingsApi?.getAiRequestParams === "function"
        ? settingsApi.getAiRequestParams(providerId, modelId)
        : {};
    const resolvedModelId =
      typeof modelInfo?.id === "string" && modelInfo.id.trim()
        ? modelInfo.id.trim()
        : modelId;

    if (!provider || !promptText || !modelId || !endpointUrl) {
      return null;
    }

    if (!apiKey && provider.apiKeyOptional !== true) {
      return null;
    }

    if (providerId === "gemini") {
      return buildGeminiRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
        responseFormat: options.responseFormat,
      });
    }

    if (providerId === "claude") {
      return buildClaudeRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
      });
    }

    if (OPENAI_COMPATIBLE_PROVIDERS.has(providerId)) {
      return buildOpenAiCompatibleRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
        responseFormat: options.responseFormat,
      });
    }

    return null;
  }

  function buildOpenAiCompatibleRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
    responseFormat,
  }) {
    const headers = {
      "content-type": "application/json",
    };

    if (apiKey && !isLmStudioProvider(providerId)) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    if (providerId === "openrouter") {
      headers["x-title"] = "Zero-Latency Web";
    }

    const body = {
      model: modelId,
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
    };
    applyCommonOpenAiCompatibleParams(body, requestParams);

    if (shouldRequestJson(responseFormat, requestParams)) {
      body.response_format = { type: "json_object" };
    }

    return {
      providerId,
      modelId,
      url: endpointUrl,
      headers,
      body,
    };
  }

  function buildGeminiRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
    responseFormat,
  }) {
    const generationConfig = {};
    applyFiniteNumberParam(generationConfig, "temperature", requestParams?.temperature);

    if (shouldRequestJson(responseFormat, requestParams)) {
      generationConfig.responseMimeType =
        typeof requestParams?.responseMimeType === "string" && requestParams.responseMimeType
          ? requestParams.responseMimeType
          : "application/json";
    }

    if (Number.isFinite(Number(requestParams?.thinkingBudget))) {
      generationConfig.thinkingConfig = {
        thinkingBudget: Math.max(0, Math.round(Number(requestParams.thinkingBudget))),
      };
    }

    return {
      providerId,
      modelId,
      url: endpointUrl.replace("{model}", encodeURIComponent(modelId)),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }],
          },
        ],
        generationConfig,
      },
    };
  }

  function buildClaudeRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
  }) {
    const body = {
      model: modelId,
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
    };
    const maxTokens = resolveMaxTokens(requestParams);

    if (maxTokens) {
      body.max_tokens = maxTokens;
    }

    applyFiniteNumberParam(body, "temperature", requestParams?.temperature);

    return {
      providerId,
      modelId,
      url: endpointUrl,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
    };
  }

  function applyCommonOpenAiCompatibleParams(body, requestParams) {
    const maxTokens = resolveMaxTokens(requestParams);

    applyFiniteNumberParam(body, "temperature", requestParams?.temperature);

    if (maxTokens) {
      body.max_tokens = maxTokens;
    }

    if (typeof requestParams?.reasoningEffort === "string" && requestParams.reasoningEffort) {
      body.reasoning_effort = requestParams.reasoningEffort;
    }

    if (Object.prototype.hasOwnProperty.call(requestParams ?? {}, "enableThinking")) {
      body.enable_thinking = Boolean(requestParams.enableThinking);
    }

    if (isPlainObject(requestParams?.reasoning)) {
      body.reasoning = { ...requestParams.reasoning };
    }
  }

  Object.assign(namespace, {
    buildAiProviderRequest,
  });
})();
