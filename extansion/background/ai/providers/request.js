(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const {
    OPENAI_COMPATIBLE_PROVIDERS,
    normalizeProviderId,
  } = namespace;
  const {
    buildOpenAiCompatibleRequest,
    buildGeminiRequest,
    buildClaudeRequest,
  } = globalThis.ZeroLatencyAiProviderRequestBuilders || {};

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

  Object.assign(namespace, {
    buildAiProviderRequest,
  });
})();
