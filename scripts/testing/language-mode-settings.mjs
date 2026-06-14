import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const i18nPath = path.join(repoRoot, "extansion", "shared", "i18n.js");
const settingsPath = path.join(repoRoot, "extansion", "shared", "settings.js");

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
    const filePath = path.join(repoRoot, "extansion", normalizedPath);
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
vm.runInContext(readFileSync(i18nPath, "utf8"), context, { filename: i18nPath });

const i18nState = await context.ZeroLatencyI18n.initialize();
assert.equal(i18nState.languageMode, "zh_CN");
assert.equal(i18nState.localeId, "zh_CN");
assert.equal(context.ZeroLatencyI18n.t("languageAuto", [], ""), "自动");

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
