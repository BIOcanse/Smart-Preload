(function () {
  const SETTINGS_STORAGE_KEY = "userSettingsV1";
  const SETTINGS_STORAGE_VERSION = 31;
  const AI_MODEL_CATALOG = globalThis.ZeroLatencyAiModelCatalog ?? null;
  const PRELOAD_RULE_CARD_IDS = [
    "nativePerPagePreloadLimit",
    "highWeightRank",
    "perPagePreloadLimit",
    "highWeightRankTab",
    "googleBookmarkRank",
  ];
  const TRACKING_RULE_CARD_IDS = [];
  const RULE_CARD_IDS = [...PRELOAD_RULE_CARD_IDS, ...TRACKING_RULE_CARD_IDS];
  const RULE_CONDITION_OPERATOR_VALUES = ["disabled", "gt", "gte", "eq", "lte", "lt"];
  const RULE_STATUS_VALUES = ["enabled", "disabled"];
  const FULLSCREEN_PRESSURE_POLICY_VALUES = ["close", "sleep", "ignore"];
  const PROXY_SKIP_MODE_VALUES = ["blacklist", "whitelist"];
  const LANGUAGE_MODE_VALUES = Array.isArray(globalThis.ZeroLatencyI18n?.LANGUAGE_MODE_VALUES)
    ? globalThis.ZeroLatencyI18n.LANGUAGE_MODE_VALUES
    : ["auto", "en", "zh_CN", "zh_TW", "ja", "ko", "de", "fr", "es", "pt_BR", "ru"];
  const TRANSITION_WINDOW_VALUES = ["total", "last365d", "last30d", "last7d", "last1d"];
  const FALLBACK_AI_PROVIDER_OPTIONS = [
    {
      value: "openai",
      label: "ChatGPT / OpenAI",
      defaultModelId: "gpt-4.1-mini",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
    },
    {
      value: "gemini",
      label: "Gemini",
      defaultModelId: "gemini-2.5-flash",
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    },
    {
      value: "claude",
      label: "Claude",
      defaultModelId: "claude-3-5-haiku-latest",
      endpointUrl: "https://api.anthropic.com/v1/messages",
    },
    {
      value: "grok",
      label: "Grok",
      defaultModelId: "grok-3-mini",
      endpointUrl: "https://api.x.ai/v1/chat/completions",
    },
    {
      value: "deepseek",
      label: "DeepSeek",
      defaultModelId: "deepseek-v4-flash",
      endpointUrl: "https://api.deepseek.com/chat/completions",
    },
    {
      value: "qwen",
      label: "Qwen",
      defaultModelId: "qwen-plus",
      endpointUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    },
    {
      value: "glm",
      label: "GLM",
      defaultModelId: "glm-4.5-flash",
      endpointUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    },
    {
      value: "kimi",
      label: "Kimi",
      defaultModelId: "kimi-k2.5",
      endpointUrl: "https://api.moonshot.ai/v1/chat/completions",
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      defaultModelId: "deepseek/deepseek-v4-flash",
      endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
    },
    {
      value: "lmstudio",
      label: "LM Studio",
      defaultModelId: "local-model",
      endpointUrl: "http://127.0.0.1:1234/v1/chat/completions",
      apiKeyOptional: true,
    },
  ];
  const AI_PROVIDER_OPTIONS = Array.isArray(AI_MODEL_CATALOG?.providerOptions)
    ? AI_MODEL_CATALOG.providerOptions
    : FALLBACK_AI_PROVIDER_OPTIONS;
  const AI_PROVIDER_VALUES = AI_PROVIDER_OPTIONS.map((option) => option.value);
  const AI_PROVIDER_BY_ID = Object.fromEntries(
    AI_PROVIDER_OPTIONS.map((option) => [option.value, option])
  );

  globalThis.ZeroLatencySettingsSchemaConstants = {
    SETTINGS_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    AI_MODEL_CATALOG,
    PRELOAD_RULE_CARD_IDS,
    TRACKING_RULE_CARD_IDS,
    RULE_CARD_IDS,
    RULE_CONDITION_OPERATOR_VALUES,
    RULE_STATUS_VALUES,
    FULLSCREEN_PRESSURE_POLICY_VALUES,
    PROXY_SKIP_MODE_VALUES,
    LANGUAGE_MODE_VALUES,
    TRANSITION_WINDOW_VALUES,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
  };
})();
