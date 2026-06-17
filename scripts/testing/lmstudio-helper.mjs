import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "shared", "lmstudio", "constants.js"],
  ["extansion", "shared", "lmstudio", "models.js"],
  ["extansion", "shared", "lmstudio", "http.js"],
  ["extansion", "shared", "lmstudio.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  AbortController,
  Promise,
  console,
  fetch: async () => {
    throw new Error("fetch should not be called in this test");
  },
  setTimeout,
  clearTimeout,
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const lmStudio = context.ZeroLatencyLmStudio;

assert.equal(lmStudio.PROVIDER_ID, "lmstudio");
assert.equal(lmStudio.API_BASE_URL, "http://127.0.0.1:1234");
assert.equal(lmStudio.CHAT_COMPLETIONS_URL, "http://127.0.0.1:1234/v1/chat/completions");
assert.equal(lmStudio.isLmStudioProvider("LMStudio"), true);
assert.equal(lmStudio.isLmStudioProvider("openai"), false);

const models = lmStudio.normalizeModelListResponse({
  models: [
    {
      id: "slow",
      name: "Slow",
      type: "llm",
    },
    {
      key: "loaded",
      display_name: "Loaded",
      loaded_instances: [{ instance_id: "loaded:1" }],
    },
    {
      id: "embedding",
      type: "embedding",
    },
  ],
});

assert.deepEqual(
  models.map((model) => model.id),
  ["loaded", "slow"]
);
assert.equal(models[0].loaded, true);
assert.deepEqual(models[0].instanceIds, ["loaded:1"]);

const missingLoadResult = await lmStudio.loadModel("", {});
assert.equal(missingLoadResult.ok, false);
assert.equal(missingLoadResult.reason, "missing-model-id");

const missingUnloadResult = await lmStudio.unloadModel("", {});
assert.equal(missingUnloadResult.ok, false);
assert.equal(missingUnloadResult.reason, "missing-model-id");

console.log("lmstudio helper tests passed");
