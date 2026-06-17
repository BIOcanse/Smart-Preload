(() => {
  const { JSON_EXTRACTION_DEFAULTS } = globalThis.ZeroLatencyAiModelCatalogDefaults;
  const providers = [
    {
      value: "deepseek",
      label: "DeepSeek",
      adapter: "openai-compatible",
      defaultModelId: "deepseek-v4-flash",
      endpointUrl: "https://api.deepseek.com/chat/completions",
      docsUrl: "https://api-docs.deepseek.com/api/list-models",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "deepseek-v4-flash",
          label: "DeepSeek V4 Flash (no-thinking)",
          recommended: true,
          aliases: ["deepseekv4-flash", "deepseek v4 flash"],
          notes:
            "Use the non-reasoning chat model for keyword extraction. Do not send thinking or reasoning budget fields.",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "deepseek-v4-pro",
          label: "DeepSeek V4 Pro",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "deepseek-chat",
          label: "DeepSeek Chat (legacy)",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "openai",
      label: "ChatGPT / OpenAI",
      adapter: "openai-compatible",
      defaultModelId: "gpt-4.1-mini",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      docsUrl: "https://platform.openai.com/docs/api-reference/chat/create-chat-completion",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "gpt-4.1-mini",
          label: "GPT-4.1 mini",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "gpt-5.1-mini",
          label: "GPT-5.1 mini",
          params: {
            ...JSON_EXTRACTION_DEFAULTS,
            reasoningEffort: "none",
          },
        },
      ],
    },
    {
      value: "gemini",
      label: "Gemini",
      adapter: "gemini",
      defaultModelId: "gemini-2.5-flash",
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
      docsUrl: "https://ai.google.dev/gemini-api/docs/thinking",
      requestDefaults: {
        ...JSON_EXTRACTION_DEFAULTS,
        responseMimeType: "application/json",
      },
      models: [
        {
          id: "gemini-2.5-flash",
          label: "Gemini 2.5 Flash (thinking budget 0)",
          recommended: true,
          params: {
            ...JSON_EXTRACTION_DEFAULTS,
            responseMimeType: "application/json",
            thinkingBudget: 0,
          },
        },
      ],
    },
    {
      value: "claude",
      label: "Claude",
      adapter: "claude",
      defaultModelId: "claude-3-5-haiku-latest",
      endpointUrl: "https://api.anthropic.com/v1/messages",
      docsUrl: "https://docs.anthropic.com/en/api/messages",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "claude-3-5-haiku-latest",
          label: "Claude 3.5 Haiku",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "grok",
      label: "Grok",
      adapter: "openai-compatible",
      defaultModelId: "grok-3-mini",
      endpointUrl: "https://api.x.ai/v1/chat/completions",
      docsUrl: "https://docs.x.ai/docs/api-reference",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "grok-3-mini",
          label: "Grok 3 mini",
          recommended: true,
          notes:
            "Kept on the legacy chat-completions endpoint for provider compatibility.",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "qwen",
      label: "Qwen",
      adapter: "openai-compatible",
      defaultModelId: "qwen-plus",
      endpointUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      docsUrl:
        "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "qwen-plus",
          label: "Qwen Plus",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "glm",
      label: "GLM",
      adapter: "openai-compatible",
      defaultModelId: "glm-4.5-flash",
      endpointUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      docsUrl: "https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "glm-4.5-flash",
          label: "GLM-4.5 Flash",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "glm-4-flash",
          label: "GLM-4 Flash",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "kimi",
      label: "Kimi",
      adapter: "openai-compatible",
      defaultModelId: "kimi-k2.5",
      endpointUrl: "https://api.moonshot.ai/v1/chat/completions",
      docsUrl: "https://platform.kimi.ai/docs/api/chat",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "kimi-k2.5",
          label: "Kimi K2.5",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "moonshot-v1-8k",
          label: "Moonshot v1 8K",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      adapter: "openai-compatible",
      defaultModelId: "deepseek/deepseek-v4-flash",
      endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
      docsUrl: "https://openrouter.ai/docs/api/api-reference/models/get-models",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      dynamicModelsUrl: "https://openrouter.ai/api/v1/models",
      models: [
        {
          id: "deepseek/deepseek-v4-flash",
          label: "DeepSeek V4 Flash",
          recommended: true,
          notes:
            "Preferred default through OpenRouter for low-latency no-thinking keyword extraction.",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "deepseek/deepseek-v4-pro",
          label: "DeepSeek V4 Pro",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "qwen/qwen3.6-flash",
          label: "Qwen3.6 Flash",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "qwen/qwen3.6-plus",
          label: "Qwen3.6 Plus",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "z-ai/glm-4.7-flash",
          label: "GLM 4.7 Flash",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "moonshotai/kimi-k2.6",
          label: "Kimi K2.6",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "~google/gemini-flash-latest",
          label: "Gemini Flash Latest",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "~openai/gpt-mini-latest",
          label: "OpenAI GPT Mini Latest",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "~anthropic/claude-haiku-latest",
          label: "Claude Haiku Latest",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "x-ai/grok-4.1-fast",
          label: "Grok 4.1 Fast",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
        {
          id: "deepseek/deepseek-chat-v3-0324:free",
          label: "DeepSeek Chat V3 (legacy free)",
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
    {
      value: "lmstudio",
      label: "LM Studio",
      adapter: "openai-compatible",
      defaultModelId: "local-model",
      endpointUrl: "http://127.0.0.1:1234/v1/chat/completions",
      apiKeyOptional: true,
      docsUrl: "https://lmstudio.ai/docs/app/api/endpoints/openai",
      requestDefaults: { ...JSON_EXTRACTION_DEFAULTS },
      models: [
        {
          id: "local-model",
          label: "Local model",
          recommended: true,
          params: { ...JSON_EXTRACTION_DEFAULTS },
        },
      ],
    },
  ];

  globalThis.ZeroLatencyAiModelCatalogProviders = {
    providers,
  };
})();
