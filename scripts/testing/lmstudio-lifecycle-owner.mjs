import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const settingsRoot = path.join(repoRoot, "extension", "settings");
const settingsSources = await readJavaScriptSources(settingsRoot);

assert.doesNotMatch(
  settingsSources,
  /\.loadModel\s*\(|\.waitForModelLoaded\s*\(/u,
  "settings page must not own LM Studio model loading"
);

let activity = {
  chromeRunning: true,
  nonChromeFullscreen: false,
};
const loadCalls = [];
const waitCalls = [];
const unloadCalls = [];
const alarmCreateCalls = [];
const settings = {
  preloading: {
    enabled: true,
    aiPrediction: {
      enabled: true,
      providerId: "lmstudio",
      modelId: "local-model",
    },
  },
};
const context = vm.createContext({
  console,
  globalThis: null,
  getEffectiveExtensionSettings: () => settings,
  fetchNativeApp: async () => activity,
  chrome: {
    alarms: {
      async clear() {
        return true;
      },
      async create(name, options) {
        alarmCreateCalls.push({ name, options });
      },
    },
  },
  ZeroLatencySupport: {
    hasChromeNamespaceMethod: () => true,
  },
  ZeroLatencyAiProviderModules: {
    isLmStudioProvider: (providerId) => providerId === "lmstudio",
  },
  ZeroLatencyLmStudio: {
    async getModelStatus() {
      return { loaded: false };
    },
    async loadModel(modelId, options) {
      loadCalls.push({ modelId, options });
      return { ok: true };
    },
    async waitForModelLoaded(modelId, options) {
      waitCalls.push({ modelId, options });
      return { ok: true, model: { id: modelId }, options };
    },
    async unloadModel(modelId, options) {
      unloadCalls.push({ modelId, options });
      return { ok: true, modelId, unloaded: true };
    },
  },
  setTimeout,
  clearTimeout,
});
context.globalThis = context;

const lifecycleSource = await readFile(
  path.join(
    repoRoot,
    "extension",
    "background",
    "ai",
    "providers",
    "lmstudio-lifecycle.js"
  ),
  "utf8"
);
vm.runInContext(lifecycleSource, context, {
  filename: "background/ai/providers/lmstudio-lifecycle.js",
});

const lifecycle = context.ZeroLatencyAiProviderModules;
await lifecycle.ensureLmStudioLifecycleWatchdog(settings);
await waitFor(() => loadCalls.length === 1);
assert.equal(loadCalls[0].modelId, "local-model");
assert.ok(loadCalls[0].options.timeoutMs < 25_000);
assert.ok(waitCalls[0].options.timeoutMs <= loadCalls[0].options.timeoutMs);
assert.ok(waitCalls[0].options.requestTimeoutMs <= 5_000);
assert.ok(alarmCreateCalls[0].options.periodInMinutes >= 0.5);

settings.preloading.aiPrediction.modelId = "second-local-model";
await lifecycle.maintainLmStudioModelLifecycle(settings);
await waitFor(() => loadCalls.length === 2);
assert.ok(unloadCalls.some((call) => call.modelId === "local-model"));
assert.equal(loadCalls[1].modelId, "second-local-model");

activity = { chromeRunning: false, nonChromeFullscreen: false };
await lifecycle.maintainLmStudioModelLifecycle(settings);
assert.ok(unloadCalls.some((call) => call.modelId === "second-local-model"));
assert.ok(unloadCalls.every((call) => call.options.timeoutMs < 25_000));

console.log("LM Studio background lifecycle owner tests passed");

async function readJavaScriptSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(await readJavaScriptSources(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      sources.push(await readFile(entryPath, "utf8"));
    }
  }

  return sources.join("\n");
}

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for LM Studio lifecycle action");
}
