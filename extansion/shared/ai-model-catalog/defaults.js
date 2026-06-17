(() => {
  const JSON_EXTRACTION_DEFAULTS = {
    temperature: 0.1,
    maxTokens: 512,
    responseFormatJson: true,
  };

  const providerOptionOrder = [
    "openrouter",
    "deepseek",
    "qwen",
    "glm",
    "kimi",
    "openai",
    "gemini",
    "claude",
    "grok",
    "lmstudio",
  ];

  const primaryModelDirectory = {
    providerId: "openrouter",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    defaultModelId: "deepseek/deepseek-v4-flash",
  };

  const defaultTestConfig = {
    enabled: true,
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    endpointUrl: "https://api.deepseek.com/chat/completions",
    apiKey: "",
  };

  globalThis.ZeroLatencyAiModelCatalogDefaults = {
    JSON_EXTRACTION_DEFAULTS,
    providerOptionOrder,
    primaryModelDirectory,
    defaultTestConfig,
  };
})();
