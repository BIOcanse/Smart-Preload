import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "settings", "app-updates", "constants.js"],
  ["extansion", "settings", "app-updates", "version.js"],
  ["extansion", "settings", "app-updates", "catalog.js"],
  ["extansion", "settings", "app-updates", "service.js"],
  ["extansion", "settings", "app-updates", "view.js"],
  ["extansion", "settings", "app-updates", "controller.js"],
  ["extansion", "settings", "app-updates.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
};
context.globalThis = context;
context.ZeroLatencyI18n = {
  t(_key, _substitutions, fallback) {
    return fallback;
  },
};
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const api = context.ZeroLatencySettingsAppUpdates;

assert.equal(api.normalizeVersion("v1.2.3"), "1.2.3");
assert.equal(api.normalizeVersion("1.2"), "");
assert.equal(api.compareVersions("1.0.10", "1.0.9") > 0, true);
assert.equal(api.compareVersions("1.0.8", "1.0.9") < 0, true);

const releases = [
  buildRelease("v1.0.8"),
  buildRelease("v1.0.9"),
  buildRelease("v1.0.11"),
  buildRelease("v1.0.10"),
  buildRelease("v2.0.0", { prerelease: true }),
  buildRelease("v1.1.0", { missingAsset: true }),
];
const catalog = api.buildUpgradeableCatalog(releases, "1.0.9");

assert.deepEqual(
  Array.from(catalog, (entry) => entry.version),
  ["1.0.9", "1.0.10", "1.0.11"]
);
assert.equal(catalog[0].current, true);
assert.equal(catalog[1].assetName, "zero-latency-web-app-windows-x64-v1.0.10.zip");

console.log("app update catalog tests passed");

function buildRelease(version, options = {}) {
  const normalizedVersion = version.replace(/^v/u, "");
  const assetName = `zero-latency-web-app-windows-x64-v${normalizedVersion}.zip`;

  return {
    tag_name: version,
    name: version,
    html_url: `https://github.com/BIOcanse/Smart-Preload/releases/tag/${version}`,
    draft: false,
    prerelease: options.prerelease === true,
    assets: options.missingAsset
      ? []
      : [
          {
            name: assetName,
            browser_download_url: `https://github.com/BIOcanse/Smart-Preload/releases/download/${version}/${assetName}`,
          },
        ],
  };
}
