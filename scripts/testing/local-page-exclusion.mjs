import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "shared", "settings", "utils.js"],
  ["extension", "shared", "settings", "schema", "localize.js"],
  ["extension", "shared", "settings", "schema", "constants.js"],
  ["extension", "shared", "settings", "schema", "options.js"],
  ["extension", "shared", "settings", "schema", "rule-cards.js"],
  ["extension", "shared", "settings", "schema.js"],
  ["extension", "shared", "settings", "defaults.js"],
  ["extension", "shared", "settings", "rules.js"],
  ["extension", "shared", "settings", "proxy-skip.js"],
  ["extension", "shared", "settings", "ai.js"],
  ["extension", "shared", "settings", "effective.js"],
  ["extension", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extension", "shared", "settings", "normalize", "preload.js"],
  ["extension", "shared", "settings", "normalize", "scheduler.js"],
  ["extension", "shared", "settings", "normalize.js"],
  ["extension", "shared", "settings", "storage.js"],
  ["extension", "shared", "settings.js"],
  ["extension", "background", "tracking", "url", "google.js"],
  ["extension", "background", "tracking", "url", "network.js"],
  ["extension", "background", "tracking", "url", "model.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Math,
  Number,
  URL,
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

let activeSettings = context.ZeroLatencySettings.normalizeStoredSettings({});
context.getEffectiveExtensionSettings = () => activeSettings;

assert.equal(activeSettings.tracking.excludeLocalPages, true);
assert.equal(activeSettings.tracking.excludePrivateNetworkPages, true);
assert.equal(activeSettings.tracking.excludeHttpPages, true);
assert.equal(context.isHttpPageUrl("http://example.com/app"), true);
assert.equal(context.isHttpPageUrl("https://example.com/app"), false);
assert.equal(context.isLocalPageUrl("http://localhost:3000/app"), true);
assert.equal(context.isLocalPageUrl("http://dev.localhost/app"), true);
assert.equal(context.isLocalPageUrl("http://127.42.0.1:5173/app"), true);
assert.equal(context.isLocalPageUrl("http://0.0.0.0:8080/app"), true);
assert.equal(context.isLocalPageUrl("http://[::1]:3000/app"), true);
assert.equal(context.isLocalPageUrl("http://192.168.0.1/admin"), false);
assert.equal(context.isLocalPageUrl("http://10.0.0.2/app"), false);
assert.equal(context.isLocalPageUrl("https://example.com/app"), false);
assert.equal(context.isPrivateNetworkPageUrl("http://192.168.0.1/admin"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://10.0.0.2/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://172.16.0.1/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://172.31.255.255/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://169.254.1.1/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://[fc00::1]/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://[fd12:3456::1]/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://[fe80::1]/app"), true);
assert.equal(context.isPrivateNetworkPageUrl("http://172.32.0.1/app"), false);
assert.equal(context.isPrivateNetworkPageUrl("http://8.8.8.8/app"), false);
assert.equal(context.isPrivateNetworkPageUrl("https://example.com/app"), false);

assert.equal(context.isExcludedLocalPage("http://localhost:3000/app"), true);
assert.equal(context.isExcludedHttpPage("http://example.com/app"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://example.com/app"), false);
assert.equal(context.isTrackableAndAllowedUrl("https://example.com/app"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://localhost:3000/app"), false);
assert.equal(
  context.normalizeNavigableUrl("http://127.0.0.1:5173/target", "https://source.example/page"),
  null
);
assert.equal(context.isExcludedPrivateNetworkPage("http://192.168.0.1/admin"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://192.168.0.1/admin"), false);
assert.equal(
  context.normalizeNavigableUrl("http://10.0.0.2/target", "https://source.example/page"),
  null
);

activeSettings = context.ZeroLatencySettings.normalizeStoredSettings({
  tracking: {
    excludeHttpPages: false,
    excludeLocalPages: false,
    excludePrivateNetworkPages: false,
  },
});

assert.equal(activeSettings.tracking.excludeHttpPages, false);
assert.equal(activeSettings.tracking.excludeLocalPages, false);
assert.equal(activeSettings.tracking.excludePrivateNetworkPages, false);
assert.equal(context.isExcludedHttpPage("http://example.com/app"), false);
assert.equal(context.isExcludedLocalPage("http://localhost:3000/app"), false);
assert.equal(context.isExcludedPrivateNetworkPage("http://192.168.0.1/admin"), false);
assert.equal(context.isTrackableAndAllowedUrl("http://example.com/app"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://localhost:3000/app"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://192.168.0.1/admin"), true);
assert.equal(
  context.normalizeNavigableUrl("http://127.0.0.1:5173/target", "https://source.example/page"),
  "http://127.0.0.1:5173/target"
);
assert.equal(
  context.normalizeNavigableUrl("http://10.0.0.2/target", "https://source.example/page"),
  "http://10.0.0.2/target"
);

activeSettings = context.ZeroLatencySettings.normalizeStoredSettings({
  tracking: {
    excludeHttpPages: false,
    excludeLocalPages: true,
    excludePrivateNetworkPages: true,
  },
});

assert.equal(context.isTrackableAndAllowedUrl("http://example.com/app"), true);
assert.equal(context.isTrackableAndAllowedUrl("http://localhost:3000/app"), false);
assert.equal(context.isTrackableAndAllowedUrl("http://192.168.0.1/admin"), false);

console.log("HTTP, local, and private network page exclusion tests passed");
