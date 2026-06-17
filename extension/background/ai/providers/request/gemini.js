(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const requestBuilders = (globalThis.ZeroLatencyAiProviderRequestBuilders =
    globalThis.ZeroLatencyAiProviderRequestBuilders || {});
  const {
    shouldRequestJson,
    applyFiniteNumberParam,
  } = namespace;

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

  Object.assign(requestBuilders, {
    buildGeminiRequest,
  });
})();
