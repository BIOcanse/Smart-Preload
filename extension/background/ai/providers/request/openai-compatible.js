(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const requestBuilders = (globalThis.ZeroLatencyAiProviderRequestBuilders =
    globalThis.ZeroLatencyAiProviderRequestBuilders || {});
  const {
    isLmStudioProvider,
    shouldRequestJson,
    resolveMaxTokens,
    applyFiniteNumberParam,
    isPlainObject,
  } = namespace;

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
      headers["x-title"] = "Smart Preload";
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

  Object.assign(requestBuilders, {
    buildOpenAiCompatibleRequest,
  });
})();
