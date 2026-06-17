import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const i18nPaths = [
  ["extension", "shared", "i18n", "constants.js"],
  ["extension", "shared", "i18n", "locale.js"],
  ["extension", "shared", "i18n", "messages.js"],
  ["extension", "shared", "i18n", "dom.js"],
  ["extension", "shared", "i18n.js"],
].map((segments) => path.join(repoRoot, ...segments));
const settingsUtilsPath = path.join(repoRoot, "extension", "shared", "settings", "utils.js");
const settingsSchemaSupportPaths = [
  ["extension", "shared", "settings", "schema", "localize.js"],
  ["extension", "shared", "settings", "schema", "constants.js"],
  ["extension", "shared", "settings", "schema", "options.js"],
  ["extension", "shared", "settings", "schema", "rule-cards.js"],
].map((segments) => path.join(repoRoot, ...segments));
const settingsSchemaPath = path.join(repoRoot, "extension", "shared", "settings", "schema.js");
const settingsDefaultsPath = path.join(repoRoot, "extension", "shared", "settings", "defaults.js");
const settingsRulesPath = path.join(repoRoot, "extension", "shared", "settings", "rules.js");
const settingsProxySkipPath = path.join(repoRoot, "extension", "shared", "settings", "proxy-skip.js");
const settingsAiPath = path.join(repoRoot, "extension", "shared", "settings", "ai.js");
const settingsEffectivePath = path.join(repoRoot, "extension", "shared", "settings", "effective.js");
const settingsNormalizeAppearanceLayoutPath = path.join(
  repoRoot,
  "extension",
  "shared",
  "settings",
  "normalize",
  "appearance-layout.js"
);
const settingsNormalizePreloadPath = path.join(
  repoRoot,
  "extension",
  "shared",
  "settings",
  "normalize",
  "preload.js"
);
const settingsNormalizeSchedulerPath = path.join(
  repoRoot,
  "extension",
  "shared",
  "settings",
  "normalize",
  "scheduler.js"
);
const settingsNormalizePath = path.join(repoRoot, "extension", "shared", "settings", "normalize.js");
const settingsStoragePath = path.join(repoRoot, "extension", "shared", "settings", "storage.js");
const settingsPath = path.join(repoRoot, "extension", "shared", "settings.js");

const storedSettings = {
  userSettingsV1: {
    appearance: {
      languageMode: "zh_CN",
    },
  },
};

const context = {
  console,
  navigator: {
    language: "en-US",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "node-test",
  },
  chrome: {
    i18n: {
      getUILanguage() {
        return "en-US";
      },
      getMessage() {
        return "";
      },
    },
    runtime: {
      getURL(urlPath) {
        return urlPath;
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return {
            ...defaults,
            ...storedSettings,
          };
        },
      },
    },
  },
  async fetch(urlPath) {
    const normalizedPath = String(urlPath).replaceAll("/", path.sep);
    const filePath = path.join(repoRoot, "extension", normalizedPath);
    return {
      ok: true,
      async json() {
        return JSON.parse(readFileSync(filePath, "utf8"));
      },
    };
  },
};
context.globalThis = context;

vm.createContext(context);
for (const i18nPath of i18nPaths) {
  vm.runInContext(readFileSync(i18nPath, "utf8"), context, { filename: i18nPath });
}

const i18nState = await context.ZeroLatencyI18n.initialize();
assert.equal(i18nState.languageMode, "zh_CN");
assert.equal(i18nState.localeId, "zh_CN");
assert.equal(context.ZeroLatencyI18n.t("languageAuto", [], ""), "自动");

vm.runInContext(readFileSync(settingsUtilsPath, "utf8"), context, {
  filename: settingsUtilsPath,
});
for (const settingsSchemaSupportPath of settingsSchemaSupportPaths) {
  vm.runInContext(readFileSync(settingsSchemaSupportPath, "utf8"), context, {
    filename: settingsSchemaSupportPath,
  });
}
vm.runInContext(readFileSync(settingsSchemaPath, "utf8"), context, {
  filename: settingsSchemaPath,
});
vm.runInContext(readFileSync(settingsDefaultsPath, "utf8"), context, {
  filename: settingsDefaultsPath,
});
vm.runInContext(readFileSync(settingsRulesPath, "utf8"), context, {
  filename: settingsRulesPath,
});
vm.runInContext(readFileSync(settingsProxySkipPath, "utf8"), context, {
  filename: settingsProxySkipPath,
});
vm.runInContext(readFileSync(settingsAiPath, "utf8"), context, {
  filename: settingsAiPath,
});
vm.runInContext(readFileSync(settingsEffectivePath, "utf8"), context, {
  filename: settingsEffectivePath,
});
vm.runInContext(readFileSync(settingsNormalizeAppearanceLayoutPath, "utf8"), context, {
  filename: settingsNormalizeAppearanceLayoutPath,
});
vm.runInContext(readFileSync(settingsNormalizePreloadPath, "utf8"), context, {
  filename: settingsNormalizePreloadPath,
});
vm.runInContext(readFileSync(settingsNormalizeSchedulerPath, "utf8"), context, {
  filename: settingsNormalizeSchedulerPath,
});
vm.runInContext(readFileSync(settingsNormalizePath, "utf8"), context, {
  filename: settingsNormalizePath,
});
vm.runInContext(readFileSync(settingsStoragePath, "utf8"), context, {
  filename: settingsStoragePath,
});
vm.runInContext(readFileSync(settingsPath, "utf8"), context, { filename: settingsPath });

const settingsApi = context.ZeroLatencySettings;
assert.equal(settingsApi.DEFAULT_SETTINGS.appearance.languageMode, "auto");
assert.equal(
  settingsApi.normalizeStoredSettings({ appearance: { languageMode: "ru" } }).appearance
    .languageMode,
  "ru"
);
assert.equal(
  settingsApi.normalizeStoredSettings({ appearance: { languageMode: "bad-locale" } }).appearance
    .languageMode,
  "auto"
);
assert.equal(settingsApi.TRANSITION_WINDOW_OPTIONS[0].label, "总量");
assert.equal(settingsApi.RULE_OPERATOR_OPTIONS[0].label, "禁用");

await context.ZeroLatencyI18n.setLanguageMode("en");
settingsApi.refreshLocalizedText();
assert.equal(settingsApi.TRANSITION_WINDOW_OPTIONS[0].label, "Total");
assert.equal(settingsApi.RULE_OPERATOR_OPTIONS[0].label, "Disabled");

console.log("language mode settings tests passed");
