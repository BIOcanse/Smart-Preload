import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPath = path.join(
  repoRoot,
  "extension",
  "background",
  "diagnostics",
  "sanitize.js"
);

const context = {
  console,
  Number,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

const sanitizer = context.ZeroLatencyDiagnosticSanitizer;

assert.equal(sanitizer.normalizeEventCategory("tracking.visit.saved"), "tracking");
assert.equal(sanitizer.normalizeLevel("warn"), "warn");
assert.equal(sanitizer.normalizeLevel("verbose"), "info");
assert.equal(sanitizer.normalizeOptionalInteger("12"), 12);
assert.equal(sanitizer.normalizeOptionalInteger("12.5"), null);

const payload = sanitizer.sanitizeDiagnosticPayload({
  apiKey: "sk-secret",
  authorization: "Bearer token",
  nested: {
    refreshToken: "hidden",
    password: "hidden",
    safe: "visible",
  },
  longText: "x".repeat(5000),
  list: Array.from({ length: 120 }, (_, index) => index),
});

assert.equal(payload.apiKey, "[redacted]");
assert.equal(payload.authorization, "[redacted]");
assert.equal(payload.nested.refreshToken, "[redacted]");
assert.equal(payload.nested.password, "[redacted]");
assert.equal(payload.nested.safe, "visible");
assert.equal(payload.longText.endsWith("...[truncated]"), true);
assert.equal(payload.list.length, 100);

const settings = sanitizer.sanitizeSettingsForDiagnostics({
  preloading: {
    aiPrediction: {
      apiKeys: {
        openai: "sk-openai",
        local: "",
      },
    },
  },
});

assert.deepEqual(JSON.parse(JSON.stringify(settings.preloading.aiPrediction.apiKeys)), {
  openai: "[redacted]",
  local: "",
});

console.log("diagnostics sanitizer tests passed");
