import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "background", "actions", "messages", "source-skip.js"],
  ["extension", "background", "actions", "messages", "attention.js"],
  ["extension", "background", "actions", "messages.js"],
].map((segments) => path.join(repoRoot, ...segments));

const events = [];
const attentionRecords = [];
const context = {
  console,
  getEffectiveExtensionSettings() {
    return context.currentSettings;
  },
  async loadPreloadState() {
    context.loadedPreloadState = true;
    return { ok: true };
  },
  async savePreloadState(state) {
    context.savedPreloadState = state;
  },
  currentSettings: {
    preloading: {
      excludeIncognitoWindows: true,
    },
  },
  loadedPreloadState: false,
  savedPreloadState: null,
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  record(name, payload) {
    events.push({ name, payload });
  },
};
context.ZeroLatencyCoreMessages = {
  handleGetServiceState() {
    return { ok: true, serviceState: { paused: false } };
  },
};
context.ZeroLatencyPreloadRuntimeManager = {
  registerCandidates(message, sender) {
    return { ok: true, action: "registered", message, senderTabId: sender?.tab?.id ?? null };
  },
};
context.ZeroLatencyPreloadSchedulerAttention = {
  async recordActiveTabAttentionFromSender(sender, reason, payload) {
    attentionRecords.push({ senderTabId: sender?.tab?.id ?? null, reason, payload });
  },
};
context.ZeroLatencyPreloadIncognitoPolicy = {
  shouldExcludeIncognitoPreloadSource(sourceTab) {
    return sourceTab?.incognito === true;
  },
  async clearExcludedIncognitoPreloadState(preloadState) {
    return {
      mutated: true,
      preloadState: {
        ...preloadState,
        cleaned: true,
      },
    };
  },
};
context.ZeroLatencyPreloadProxySkipPolicy = {
  shouldSkipProxyPreloadSource() {
    return false;
  },
};
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const actions = context.ZeroLatencyMessageActions;

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await actions.executeMessageDecision(
        {
          actionKey: "get-service-state",
        },
        {
          raw: {
            message: {},
            sender: {},
          },
        }
      )
    )
  ),
  {
    ok: true,
    serviceState: {
      paused: false,
    },
  }
);

const registerResult = await actions.executeMessageDecision(
  {
    actionKey: "register-preload-candidates",
  },
  {
    raw: {
      message: {
        attentionActivity: {
          input: true,
        },
      },
      sender: {
        tab: {
          id: 12,
          incognito: false,
        },
      },
    },
  }
);
assert.equal(registerResult.action, "registered");
assert.equal(attentionRecords[0].reason, "preload-candidate-scan");
assert.equal(attentionRecords[0].senderTabId, 12);

const skipped = await actions.executeMessageDecision(
  {
    actionKey: "register-preload-candidates",
  },
  {
    raw: {
      message: {},
      sender: {
        tab: {
          id: 99,
          windowId: 9,
          incognito: true,
          url: "https://private.example/",
        },
      },
    },
  }
);
assert.equal(skipped.reason, "incognito-excluded");
assert.equal(context.loadedPreloadState, true);
assert.equal(context.savedPreloadState.cleaned, true);
assert.equal(events.at(-1).name, "message.skip-incognito-source");

console.log("message actions tests passed");
