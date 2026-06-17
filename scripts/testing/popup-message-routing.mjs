import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "background", "intercept", "messages.js"],
  ["extension", "background", "judge", "messages.js"],
  ["extension", "background", "core", "messages", "service-control.js"],
  ["extension", "background", "core", "messages", "native-app-update.js"],
  ["extension", "background", "core", "router", "messages.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
};
context.globalThis = context;
context.isKnownPreloadContext = () => false;
context.ZeroLatencyMessageActions = {
  async executeMessageDecision() {
    return { ok: true };
  },
};
context.getCachedServiceState = () => ({
  paused: false,
  updatedAt: "2026-06-13T00:00:00.000Z",
});
context.loadServiceState = async () => {
  throw new Error("UI service state requests must use the cached service state");
};
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

assert.equal(createTask({ type: "visit-graph:get-debug-snapshot" }).queueMode, "direct");
assert.equal(createTask({ type: "extension:open-settings" }).queueMode, "direct");
assert.equal(createTask({ type: "extension:get-service-state" }).queueMode, "direct");
assert.equal(createTask({ type: "native-app:update-status" }).queueMode, "direct");
assert.equal(createTask({ type: "native-app:update-to-version" }).queueMode, "mutation");
assert.equal(createTask({ type: "extension:set-service-paused" }).queueMode, "mutation");
assert.equal(createTask({ type: "visit-graph:reset" }).queueMode, "mutation");
assert.equal(createTask({ type: "visit-graph:delete-history-range" }).queueMode, "mutation");
assert.equal(
  createTask(
    {
      type: "preload:register-candidates",
    },
    buildTabSender()
  ).queueMode,
  "side-effect"
);
assert.equal(
  createTask(
    {
      type: "preload:interaction-status",
      url: "https://target.example/page",
    },
    buildTabSender()
  ).queueMode,
  "side-effect"
);
assert.equal(
  createTask(
    {
      type: "attention:activity",
    },
    buildTabSender()
  ).queueMode,
  "side-effect"
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(await context.ZeroLatencyCoreServiceControlMessages.handleGetServiceState())
  ),
  {
    ok: true,
    serviceState: {
      paused: false,
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
  }
);

console.log("popup message routing tests passed");

function createTask(message, sender = null) {
  const task = context.ZeroLatencyRouterMessages.createMessageTask(message, sender);
  assert.ok(task, `expected task for ${message.type}`);
  return task;
}

function buildTabSender() {
  return {
    tab: {
      id: 101,
      windowId: 10,
      url: "https://source.example/page",
    },
  };
}
