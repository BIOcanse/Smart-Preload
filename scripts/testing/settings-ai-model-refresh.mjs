import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

await testLoaderCacheCancellationAndTimeout();
await testRefreshDebounceAndSupersession();
console.log("settings AI model refresh tests passed");

async function testLoaderCacheCancellationAndTimeout() {
  let fetchCalls = 0;
  let fetchMode = "success";
  const context = createContext({
    ZeroLatencySettingsAiModelProvider: {
      isLmStudioProvider: (providerId) => providerId === "lmstudio",
      buildModelsRequest: (_providerId, endpointUrl, apiKey) => ({
        url: `${endpointUrl}?credential=${apiKey}`,
        headers: {},
      }),
    },
    ZeroLatencySettingsAiModelFilters: {
      getCatalogModels: () => [{ id: "preset", label: "Preset" }],
      filterAndSortProviderModels: (models, _providerId, catalogModels) =>
        models.length > 0 ? models : catalogModels,
      filterAndSortLmStudioModels: (models) => models,
    },
    fetch: async (_url, options) => {
      fetchCalls += 1;

      if (fetchMode === "success") {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ data: [{ id: "remote-model" }] });
          },
        };
      }

      return await new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    },
  });
  await runScript(context, "extension/settings/ai-models/loader.js");
  const loader = context.ZeroLatencySettingsAiModels;

  const baseRequest = {
    providerId: "openai",
    provider: { apiKeyOptional: false },
    endpointUrl: "https://models.example/v1/models",
    apiKey: "cache-key",
  };
  const first = await loader.loadProviderModelOptions(baseRequest);
  const second = await loader.loadProviderModelOptions(baseRequest);
  assert.equal(first.status, "remote");
  assert.equal(second.cacheHit, true);
  assert.equal(fetchCalls, 1);

  fetchMode = "pending";
  const externalController = new AbortController();
  const cancelled = loader.loadProviderModelOptions({
    ...baseRequest,
    apiKey: "cancel-key",
    signal: externalController.signal,
  });
  externalController.abort();
  await assert.rejects(cancelled, (error) => error?.name === "AbortError");

  const timedOut = await loader.loadProviderModelOptions({
    ...baseRequest,
    apiKey: "timeout-key",
    timeoutMs: 20,
  });
  assert.equal(timedOut.status, "timeout");
  assert.equal(timedOut.timeoutMs, 20);
  assert.ok(loader.MODEL_OPTIONS_REQUEST_TIMEOUT_MS < 25_000);
}

async function testRefreshDebounceAndSupersession() {
  const invocations = [];
  const elements = {
    aiPredictionProvider: { value: "openai" },
    aiPredictionModel: { value: "preset", title: "" },
    aiProviderApiKey: { value: "slow-key" },
    aiProviderEndpoint: { value: "https://models.example/v1/models" },
    aiModelListMode: { value: "recommended" },
  };
  const context = createContext({
    ZeroLatencySettingsAiModelRecommendations: {
      selectModelsForListMode: ({ models }) => models,
    },
  });
  await runScript(context, "extension/settings/ai-models/options-refresh.js");
  const api = context.ZeroLatencySettingsAiModelOptionsRefresher;
  assert.equal(api.MODEL_OPTIONS_DEBOUNCE_MS, 400);

  const refresher = api.create({
    elements,
    settingsApi: {
      AI_PROVIDER_BY_ID: {
        openai: { apiKeyOptional: false },
      },
    },
    modelLoader: {
      async loadProviderModelOptions(request) {
        invocations.push(request);
        if (request.apiKey !== "slow-key") {
          return { status: "remote", models: [{ id: "fast", label: "Fast" }] };
        }

        return await new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        });
      },
    },
    modelSelect: {
      getCuratedAiModelOptions: () => [{ id: "preset", label: "Preset" }],
      renderModelSelectOptions: ({ selectedModelId, models }) =>
        models.some((model) => model.id === selectedModelId)
          ? selectedModelId
          : models[0]?.id || "",
    },
    translate: (_key, _substitutions, fallback) => fallback,
    isProviderLmStudio: () => false,
    readFormSettings: () => ({
      preloading: { aiPrediction: { modelListMode: "recommended" } },
    }),
    setDraftSettings() {},
    updateComputedState() {},
    syncMismatchWarning() {},
  });

  const slowRequest = refresher.refreshModelOptions({
    providerId: "openai",
    selectedModelId: "preset",
    apiKey: "slow-key",
    endpointUrl: elements.aiProviderEndpoint.value,
  });
  await sleep(10);

  elements.aiProviderApiKey.value = "first-key";
  const supersededScheduled = refresher.refreshOptionsForCurrentProvider();
  elements.aiProviderApiKey.value = "latest-key";
  const latestScheduled = refresher.refreshOptionsForCurrentProvider();

  assert.equal((await slowRequest).status, "cancelled");
  assert.equal((await supersededScheduled).status, "cancelled");
  assert.equal(invocations.length, 1);
  await sleep(api.MODEL_OPTIONS_DEBOUNCE_MS - 50);
  assert.equal(invocations.length, 1);
  assert.equal((await latestScheduled).status, "remote");
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0].signal.aborted, true);
  assert.equal(invocations[1].apiKey, "latest-key");
}

function createContext(overrides = {}) {
  const context = vm.createContext({
    AbortController,
    Array,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    String,
    URL,
    clearTimeout,
    console,
    setTimeout,
    ...overrides,
  });
  context.globalThis = context;
  return context;
}

async function runScript(context, relativePath) {
  const source = await readFile(path.join(repoRoot, ...relativePath.split("/")), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
