import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const context = vm.createContext({ console });
context.globalThis = context;

const source = await readFile(
  path.join(
    repoRoot,
    "extension",
    "settings",
    "dialogs",
    "real-preload-risk.js"
  ),
  "utf8"
);
vm.runInContext(source, context, {
  filename: "settings/dialogs/real-preload-risk.js",
});

let confirmCalls = 0;
let typedConfirmCalls = 0;
const guard = context.ZeroLatencySettingsRealPreloadRiskDialog.createRealPreloadRiskGuard({
  dialog: {
    async confirm() {
      confirmCalls += 1;
      await Promise.resolve();
      return true;
    },
    async confirmText() {
      typedConfirmCalls += 1;
      await Promise.resolve();
      return true;
    },
  },
  translate: (_key, _substitutions, fallback) => fallback,
  settingsApi: {
    isRealPreloadEnabled(settings) {
      return settings?.preloading?.realPreloadEnabled === true;
    },
  },
});

const saved = {
  preloading: {
    realPreloadEnabled: false,
    realPreloadRiskAcknowledged: false,
  },
};
const firstDraft = {
  preloading: {
    realPreloadEnabled: true,
    realPreloadRiskAcknowledged: false,
  },
};
const duplicateEventDraft = structuredClone(firstDraft);

const [firstResult, duplicateResult] = await Promise.all([
  guard.confirmIfNeeded(saved, firstDraft),
  guard.confirmIfNeeded(saved, duplicateEventDraft),
]);

assert.equal(firstResult, true);
assert.equal(duplicateResult, true);
assert.equal(confirmCalls, 2, "risk and disclaimer dialogs should each open once");
assert.equal(typedConfirmCalls, 1, "typed confirmation should open once");
assert.equal(firstDraft.preloading.realPreloadRiskAcknowledged, true);
assert.equal(duplicateEventDraft.preloading.realPreloadRiskAcknowledged, true);

const laterDraftSnapshot = structuredClone(firstDraft);
laterDraftSnapshot.preloading.realPreloadRiskAcknowledged = false;
assert.equal(await guard.confirmIfNeeded(saved, laterDraftSnapshot), true);
assert.equal(laterDraftSnapshot.preloading.realPreloadRiskAcknowledged, true);
assert.equal(confirmCalls, 2);
assert.equal(typedConfirmCalls, 1);

console.log("settings real preload risk single-flight tests passed");
