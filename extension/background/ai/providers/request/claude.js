(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const requestBuilders = (globalThis.ZeroLatencyAiProviderRequestBuilders =
    globalThis.ZeroLatencyAiProviderRequestBuilders || {});
  const {
    resolveMaxTokens,
    applyFiniteNumberParam,
  } = namespace;

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

  Object.assign(requestBuilders, {
    buildClaudeRequest,
  });
})();
