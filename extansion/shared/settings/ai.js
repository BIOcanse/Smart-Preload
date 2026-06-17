(function () {
  const { cloneSettings, isPlainObject, mergeSettings } = globalThis.ZeroLatencySettingsUtils;
  const {
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
    AI_MODEL_CATALOG,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function normalizeAiProviderId(
    value,
    fallback = DEFAULT_SETTINGS.preloading.aiPrediction.providerId
  ) {
    return AI_PROVIDER_VALUES.includes(value) ? value : fallback;
  }

  function normalizeAiProviderStringMap(value, fallbackMap) {
    const normalizedMap = cloneSettings(fallbackMap);

    if (!isPlainObject(value)) {
      return normalizedMap;
    }

    for (const providerId of AI_PROVIDER_VALUES) {
      const rawValue = value[providerId];

      if (typeof rawValue === "string") {
        normalizedMap[providerId] = rawValue.trim();
      }
    }

    return normalizedMap;
  }

  function getAiModelInfo(providerId, modelId) {
    const modelInfo = AI_MODEL_CATALOG?.getModel?.(providerId, modelId);
    return isPlainObject(modelInfo) ? cloneSettings(modelInfo) : null;
  }

  function getAiProviderModels(providerId) {
    const provider = AI_MODEL_CATALOG?.getProvider?.(providerId);
    return Array.isArray(provider?.models) ? cloneSettings(provider.models) : [];
  }

  function getAiRequestParams(providerId, modelId) {
    const requestParams = AI_MODEL_CATALOG?.getRequestParams?.(providerId, modelId);

    return isPlainObject(requestParams)
      ? cloneSettings(requestParams)
      : {
          temperature: 0.1,
          maxTokens: 512,
          responseFormatJson: true,
        };
  }

  function normalizeAiPredictionSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.aiPrediction, value);
    const providerId = normalizeAiProviderId(mergedValue.providerId);
    const modelIds = normalizeAiProviderStringMap(
      mergedValue.modelIds,
      DEFAULT_SETTINGS.preloading.aiPrediction.modelIds
    );
    const endpointUrls = normalizeAiProviderStringMap(
      mergedValue.endpointUrls,
      DEFAULT_SETTINGS.preloading.aiPrediction.endpointUrls
    );
    const apiKeys = normalizeAiProviderStringMap(
      mergedValue.apiKeys,
      DEFAULT_SETTINGS.preloading.aiPrediction.apiKeys
    );
    const legacyModelId =
      typeof mergedValue.modelId === "string" ? mergedValue.modelId.trim() : "";

    if (legacyModelId && !modelIds[providerId]) {
      modelIds[providerId] = legacyModelId;
    }

    return {
      enabled: Boolean(mergedValue.enabled),
      providerId,
      modelId: modelIds[providerId] || AI_PROVIDER_BY_ID[providerId]?.defaultModelId || "",
      apiKeys,
      modelIds,
      endpointUrls,
    };
  }

  function isAiPredictionConfigured(aiPredictionSettings) {
    const providerId = normalizeAiProviderId(aiPredictionSettings?.providerId);
    const provider = AI_PROVIDER_BY_ID[providerId];
    const modelId =
      typeof aiPredictionSettings?.modelId === "string"
        ? aiPredictionSettings.modelId.trim()
        : "";
    const apiKey =
      typeof aiPredictionSettings?.apiKeys?.[providerId] === "string"
        ? aiPredictionSettings.apiKeys[providerId].trim()
        : "";
    const endpointUrl =
      typeof aiPredictionSettings?.endpointUrls?.[providerId] === "string"
        ? aiPredictionSettings.endpointUrls[providerId].trim()
        : "";

    if (!provider || !modelId || !endpointUrl) {
      return false;
    }

    return provider.apiKeyOptional === true || Boolean(apiKey);
  }

  globalThis.ZeroLatencySettingsAi = {
    normalizeAiProviderId,
    getAiModelInfo,
    getAiProviderModels,
    getAiRequestParams,
    normalizeAiPredictionSettings,
    isAiPredictionConfigured,
  };
})();
