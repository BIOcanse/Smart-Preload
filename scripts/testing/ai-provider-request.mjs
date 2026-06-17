import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const scriptPaths = [
  path.join(repoRoot, "extansion", "background", "ai", "providers", "common.js"),
  path.join(
    repoRoot,
    "extansion",
    "background",
    "ai",
    "providers",
    "request",
    "openai-compatible.js"
  ),
  path.join(repoRoot, "extansion", "background", "ai", "providers", "request", "gemini.js"),
  path.join(repoRoot, "extansion", "background", "ai", "providers", "request", "claude.js"),
  path.join(repoRoot, "extansion", "background", "ai", "providers", "request.js"),
];

const providerCatalog = {
  openai: {
    endpointUrl: "https://api.openai.com/v1/chat/completions",
    requestParams: {
      temperature: 0.2,
      maxTokens: 300,
      reasoningEffort: "low",
      enableThinking: false,
      reasoning: { effort: "low" },
      responseFormatJson: true,
    },
  },
  gemini: {
    endpointUrl: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    requestParams: {
      temperature: 0.4,
      responseMimeType: "application/json",
      thinkingBudget: 128,
      responseFormatJson: true,
    },
  },
  claude: {
    endpointUrl: "https://api.anthropic.com/v1/messages",
    requestParams: {
      temperature: 0.1,
      maxTokens: 1024,
    },
  },
  lmstudio: {
    endpointUrl: "http://127.0.0.1:1234/v1/chat/completions",
    apiKeyOptional: true,
    requestParams: {
      temperature: 0.8,
      maxTokens: 256,
      responseFormatJson: true,
    },
  },
};

const context = {
  console,
  Math,
  Number,
  Date,
  setTimeout,
  clearTimeout,
};
context.globalThis = context;
context.ZeroLatencyLmStudio = {
  isLmStudioProvider(providerId) {
    return providerId === "lmstudio";
  },
};
context.ZeroLatencySettings = {
  AI_PROVIDER_VALUES: Object.keys(providerCatalog),
  DEFAULT_SETTINGS: {
    preloading: {
      aiPrediction: {
        providerId: "openai",
      },
    },
  },
  AI_PROVIDER_BY_ID: providerCatalog,
  getAiModelInfo(providerId, modelId) {
    return { id: modelId };
  },
  getAiRequestParams(providerId) {
    return providerCatalog[providerId]?.requestParams ?? {};
  },
};

vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const { buildAiProviderRequest } = context.ZeroLatencyAiProviderModules;

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSettings(providerId, overrides = {}) {
  const provider = providerCatalog[providerId];
  const modelId = overrides.modelId || `${providerId}-model`;

  return {
    preloading: {
      aiPrediction: {
        providerId,
        modelId,
        modelIds: {},
        endpointUrls: {
          [providerId]: overrides.endpointUrl ?? provider.endpointUrl,
        },
        apiKeys: {
          [providerId]: overrides.apiKey ?? `${providerId}-key`,
        },
      },
    },
  };
}

const openAiRequest = buildAiProviderRequest(
  makeSettings("openai", { modelId: "gpt-test" }),
  "rank these links",
  { responseFormat: "json" }
);
assert.equal(openAiRequest.providerId, "openai");
assert.equal(openAiRequest.url, providerCatalog.openai.endpointUrl);
assert.equal(openAiRequest.headers.authorization, "Bearer openai-key");
assert.deepEqual(toPlain(openAiRequest.body.messages), [
  { role: "user", content: "rank these links" },
]);
assert.equal(openAiRequest.body.temperature, 0.2);
assert.equal(openAiRequest.body.max_tokens, 300);
assert.equal(openAiRequest.body.reasoning_effort, "low");
assert.equal(openAiRequest.body.enable_thinking, false);
assert.deepEqual(toPlain(openAiRequest.body.reasoning), { effort: "low" });
assert.deepEqual(toPlain(openAiRequest.body.response_format), { type: "json_object" });

const geminiRequest = buildAiProviderRequest(
  makeSettings("gemini", { modelId: "gemini-2.5-flash" }),
  "return json",
  { responseFormat: "json" }
);
assert.equal(
  geminiRequest.url,
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
);
assert.equal(geminiRequest.headers["x-goog-api-key"], "gemini-key");
assert.deepEqual(toPlain(geminiRequest.body.contents), [
  {
    role: "user",
    parts: [{ text: "return json" }],
  },
]);
assert.equal(geminiRequest.body.generationConfig.temperature, 0.4);
assert.equal(geminiRequest.body.generationConfig.responseMimeType, "application/json");
assert.deepEqual(toPlain(geminiRequest.body.generationConfig.thinkingConfig), {
  thinkingBudget: 128,
});

const claudeRequest = buildAiProviderRequest(
  makeSettings("claude", { modelId: "claude-sonnet" }),
  "analyze",
  { responseFormat: "json" }
);
assert.equal(claudeRequest.headers["x-api-key"], "claude-key");
assert.equal(claudeRequest.headers["anthropic-version"], "2023-06-01");
assert.equal(claudeRequest.body.max_tokens, 1024);
assert.equal(claudeRequest.body.temperature, 0.1);
assert.equal(claudeRequest.body.response_format, undefined);

const lmStudioRequest = buildAiProviderRequest(
  makeSettings("lmstudio", { apiKey: "", modelId: "local-model" }),
  "local rank",
  { responseFormat: "json" }
);
assert.equal(lmStudioRequest.providerId, "lmstudio");
assert.equal(lmStudioRequest.headers.authorization, undefined);
assert.equal(lmStudioRequest.body.max_tokens, 256);
assert.deepEqual(toPlain(lmStudioRequest.body.response_format), { type: "json_object" });

assert.equal(
  buildAiProviderRequest(makeSettings("openai", { apiKey: "" }), "missing key", {
    responseFormat: "json",
  }),
  null
);
assert.equal(buildAiProviderRequest(makeSettings("openai"), "   "), null);

console.log("ai provider request tests passed");
