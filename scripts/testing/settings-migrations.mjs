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
  ["extension", "shared", "settings", "migrations.js"],
].map((segments) => path.join(repoRoot, ...segments));

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
  },
};
context.globalThis = context;
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  new vm.Script(readFileSync(scriptPath, "utf8"), { filename: scriptPath }).runInContext(context);
}

const { migrateStoredSettingsToCurrentVersion } = context.globalThis.ZeroLatencySettingsMigrations;
const { SETTINGS_STORAGE_VERSION } = context.globalThis.ZeroLatencySettingsSchema;
const { DEFAULT_SETTINGS } = context.globalThis.ZeroLatencySettingsDefaults;
const LEGACY_VERSION = 30;
const schedulerDefaults = DEFAULT_SETTINGS.preloading.scheduler;

function buildStoredSettings(version, scheduler) {
  const stored = {
    preloading: {
      scheduler: { ...scheduler },
    },
  };

  if (version !== undefined) {
    stored.version = version;
  }

  return stored;
}

// 1. 停留在旧默认值上的键跟随新默认值；不等于旧默认值的键保持不变。
//
//    这是有意的迁移语义，不是 bug：设置每次保存都会把整个对象写回存储，所以每个键
//    都存在，无法区分“从没动过”和“明确选成了恰好等于旧默认值的值”。代价是后者会被
//    改写。此处把两侧行为都固定下来，将来若接入 provenance 需要一并更新。
//    另见 preload-scheduler-selections.mjs:175 对同一语义的断言。
{
  const stored = buildStoredSettings(LEGACY_VERSION, {
    attentionPoolMinutes: 300,
    attentionInputWindowSeconds: 60, // 恰好等于旧默认值 → 采用新默认值
    attentionMediaPlaybackWeight: 0.2, // 同上
    attentionAudioPlaybackWeight: 0.35, // 不等于旧默认值 0.07 → 必须保留
  });

  const migrated = migrateStoredSettingsToCurrentVersion(stored);
  const scheduler = migrated.preloading.scheduler;

  assert.equal(
    scheduler.attentionInputWindowSeconds,
    schedulerDefaults.attentionInputWindowSeconds,
    "停留在旧默认值上的输入窗口没有跟随新默认值"
  );
  assert.equal(
    scheduler.attentionMediaPlaybackWeight,
    schedulerDefaults.attentionMediaPlaybackWeight,
    "停留在旧默认值上的视频权重没有跟随新默认值"
  );
  assert.equal(scheduler.attentionAudioPlaybackWeight, 0.35, "非旧默认值的音频权重被改写了");
  assert.equal(scheduler.attentionPoolMinutes, 300, "已存在的注意力池分钟数被改写了");
}

// 2. 缺失的键仍然要补上当前默认值。
{
  const stored = buildStoredSettings(LEGACY_VERSION, {});
  const scheduler = migrateStoredSettingsToCurrentVersion(stored).preloading.scheduler;

  assert.equal(
    scheduler.attentionInputWindowSeconds,
    schedulerDefaults.attentionInputWindowSeconds
  );
  assert.equal(
    scheduler.attentionMediaPlaybackWeight,
    schedulerDefaults.attentionMediaPlaybackWeight
  );
  assert.equal(
    scheduler.attentionAudioPlaybackWeight,
    schedulerDefaults.attentionAudioPlaybackWeight
  );
  assert.equal(scheduler.attentionPoolMinutes, schedulerDefaults.attentionPoolMinutes);
}

// 3. version 缺失的数据不跑迁移，字段值原样保留，只盖章为当前版本。
//    有意行为，另见 preload-scheduler-selections.mjs:276。
//    已知缺口：真正的远古数据若丢了 version，遗留字段不会被转换。
{
  const stored = buildStoredSettings(undefined, { attentionPoolHours: 2 });
  const migrated = migrateStoredSettingsToCurrentVersion(stored);
  const scheduler = migrated.preloading.scheduler;

  assert.equal(scheduler.attentionPoolHours, 2, "无 version 的数据被意外迁移了");
  assert.equal(scheduler.attentionPoolMinutes, undefined);
  assert.equal(migrated.version, SETTINGS_STORAGE_VERSION);
}

// 4. version 非数值时同样按缺失处理。
{
  const stored = buildStoredSettings("not-a-number", { attentionPoolHours: 3 });
  const scheduler = migrateStoredSettingsToCurrentVersion(stored).preloading.scheduler;

  assert.equal(scheduler.attentionPoolHours, 3, "非数值 version 被意外迁移了");
}

// 5. 来自更新版本的设置必须原样返回，不被降级盖章。
//    否则用户回退旧版再升级时，已迁移过的数据会被当成旧数据重跑迁移。
{
  const futureVersion = SETTINGS_STORAGE_VERSION + 4;
  const stored = buildStoredSettings(futureVersion, {
    attentionInputWindowSeconds: 45,
    futureOnlyField: "keep-me",
  });

  const migrated = migrateStoredSettingsToCurrentVersion(stored);

  assert.equal(migrated.version, futureVersion, "来自更新版本的 version 被改写了");
  assert.equal(migrated.preloading.scheduler.attentionInputWindowSeconds, 45);
  assert.equal(migrated.preloading.scheduler.futureOnlyField, "keep-me", "未知字段被丢弃了");
}

// 6. 当前版本的数据不应被再次迁移。
{
  const stored = buildStoredSettings(SETTINGS_STORAGE_VERSION, {
    attentionInputWindowSeconds: 60,
    attentionPoolMinutes: 300,
  });
  const scheduler = migrateStoredSettingsToCurrentVersion(stored).preloading.scheduler;

  assert.equal(scheduler.attentionInputWindowSeconds, 60);
  assert.equal(scheduler.attentionPoolMinutes, 300);
}

// 7. 迁移必须幂等：对同一份数据连续迁移两次，结果一致。
{
  const stored = buildStoredSettings(LEGACY_VERSION, {
    attentionInputWindowSeconds: 60,
    attentionMediaPlaybackWeight: 0.2,
    attentionPoolHours: 5,
  });

  const once = migrateStoredSettingsToCurrentVersion(stored);
  const twice = migrateStoredSettingsToCurrentVersion(once);

  assert.deepEqual(twice, once, "迁移不幂等：第二次运行改变了结果");
}

// 8. 非对象输入原样返回。
{
  assert.equal(migrateStoredSettingsToCurrentVersion(null), null);
  assert.equal(migrateStoredSettingsToCurrentVersion("nope"), "nope");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 8,
      settingsStorageVersion: SETTINGS_STORAGE_VERSION,
    },
    null,
    2
  )
);

