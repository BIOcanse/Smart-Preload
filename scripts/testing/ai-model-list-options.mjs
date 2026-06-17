import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const context = {
  console,
  Number,
};
context.globalThis = context;
context.ZeroLatencyLmStudio = {
  isLmStudioProvider(providerId) {
    return providerId === "lmstudio";
  },
};

vm.createContext(context);

for (const scriptPath of [
  path.join(repoRoot, "extansion", "settings", "ai-models", "provider.js"),
  path.join(repoRoot, "extansion", "settings", "ai-models", "filters.js"),
  path.join(repoRoot, "extansion", "settings", "ai-models", "recommendations.js"),
]) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const filters = context.ZeroLatencySettingsAiModelFilters;
const recommendations = context.ZeroLatencySettingsAiModelRecommendations;
const catalogModels = [
  { id: "vendor/fast-default", label: "Fast default" },
  { id: "vendor/pro-default", label: "Pro default" },
];
const remoteModels = [
  { id: "vendor/reasoning-max", label: "Reasoning Max" },
  { id: "vendor/pro-default", label: "Pro default from remote" },
  { id: "vendor/image-model", label: "Image model" },
  { id: "vendor/fast-default", label: "Fast default from remote" },
  { id: "vendor/reasoning-max", label: "Duplicate should be ignored" },
  { id: "   " },
];

const providerModels = filters.filterAndSortProviderModels(
  remoteModels,
  "openrouter",
  catalogModels
);

assert.deepEqual(
  toPlain(providerModels.map((model) => model.id)),
  [
    "vendor/fast-default",
    "vendor/pro-default",
    "vendor/image-model",
    "vendor/reasoning-max",
  ]
);
assert.equal(providerModels[1].label, "Pro default from remote");

const geminiModels = filters.filterAndSortProviderModels(
  [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
    { id: "gemini-3.1-flash-tts", label: "Gemini 3.1 Flash TTS" },
    { id: "gemini-3.1-image", label: "Gemini 3.1 Image" },
  ],
  "gemini"
);
const recommendedGeminiModels = recommendations.selectModelsForListMode({
  models: geminiModels,
  providerId: "gemini",
  mode: "recommended",
});
assert.deepEqual(
  toPlain(recommendedGeminiModels.map((model) => model.id).sort()),
  ["gemini-3.1-flash-lite", "gemini-3.1-pro", "gemini-3.5-flash"].sort()
);
assert.equal(
  recommendations.selectModelsForListMode({
    models: geminiModels,
    providerId: "gemini",
    mode: "all",
  }).length,
  geminiModels.length
);
assert.ok(
  recommendations
    .selectModelsForListMode({
      models: geminiModels,
      providerId: "gemini",
      mode: "recommended",
      selectedModelId: "gemini-3.1-image",
    })
    .some((model) => model.id === "gemini-3.1-image")
);

const lmStudioModels = filters.filterAndSortProviderModels(
  [
    { id: "local-slow", loaded: false },
    { id: "local-loaded", loaded: true },
    { id: "local-loaded", loaded: true, label: "duplicate" },
  ],
  "lmstudio"
);

assert.deepEqual(
  toPlain(lmStudioModels.map((model) => `${model.id}:${model.statusLabel}`)),
  ["local-loaded:loaded", "local-slow:not loaded"]
);

console.log("ai model list option tests passed");

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
