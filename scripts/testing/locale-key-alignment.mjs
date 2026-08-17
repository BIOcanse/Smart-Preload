// 10 个语言包的 key 集合必须完全一致，且代码里引用的每个 key 都要存在。
//
// 手工维护 10 份 messages.json 时，最容易出的两类问题都不会在运行时报错，只会让界面
// 上出现空字符串：
//   - 只往 en 加了 key，其余 9 个语言漏掉；
//   - 改了代码里的 key 名，忘了改语言包。
//
// 这里把两类都变成机器检查。另外顺带校验 `{0}` 这类占位符在各语言间一致——占位符对不上
// 会让替换后的文案出现错位或残留标记。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const extensionRoot = path.join(repoRoot, "extension");
const localesRoot = path.join(extensionRoot, "_locales");
const BASE_LOCALE = "en";

function readMessages(locale) {
  return JSON.parse(readFileSync(path.join(localesRoot, locale, "messages.json"), "utf8"));
}

function placeholdersOf(message) {
  return [...new Set([...String(message).matchAll(/\{(\d+)\}/g)].map((match) => match[1]))].sort();
}

const locales = readdirSync(localesRoot).filter((name) =>
  statSync(path.join(localesRoot, name)).isDirectory()
);

assert.ok(locales.includes(BASE_LOCALE), `缺少基准语言 ${BASE_LOCALE}`);

const baseMessages = readMessages(BASE_LOCALE);
const baseKeys = Object.keys(baseMessages).sort();

// --- 1. 各语言 key 集合与 en 完全一致，且无空值 ---
const localeReport = [];

for (const locale of locales) {
  const messages = readMessages(locale);
  const keys = Object.keys(messages).sort();
  const missing = baseKeys.filter((key) => !(key in messages));
  const extra = keys.filter((key) => !(key in baseMessages));
  const empty = keys.filter((key) => !String(messages[key]?.message ?? "").trim());

  localeReport.push({ locale, keys: keys.length, missing, extra, empty });

  assert.deepEqual(missing, [], `${locale} 缺少 key（相对 ${BASE_LOCALE}）`);
  assert.deepEqual(extra, [], `${locale} 存在 ${BASE_LOCALE} 没有的多余 key`);
  assert.deepEqual(empty, [], `${locale} 存在空 message`);

  // --- 2. 占位符一致 ---
  for (const key of baseKeys) {
    assert.deepEqual(
      placeholdersOf(messages[key].message),
      placeholdersOf(baseMessages[key].message),
      `${locale} 的 ${key} 占位符与 ${BASE_LOCALE} 不一致`
    );
  }
}

// --- 3. 代码里引用的 key 必须存在 ---
// 本项目不直接调 chrome.i18n.getMessage，而是用 t(key, subs, fallback) 和 data-i18n*
// 属性；manifest 用 __MSG_x__。三种形式都扫。
const sourceFiles = [];
const stack = [extensionRoot];

while (stack.length > 0) {
  const current = stack.pop();

  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);

    if (entry.isDirectory()) {
      if (!/_locales|wasm|images/.test(entryPath)) {
        stack.push(entryPath);
      }
    } else if (/\.(js|html)$/.test(entry.name)) {
      sourceFiles.push(entryPath);
    }
  }
}

sourceFiles.push(path.join(extensionRoot, "manifest.json"));

const referenced = new Map();

for (const filePath of sourceFiles) {
  const source = readFileSync(filePath, "utf8");
  const relativePath = path.relative(repoRoot, filePath);
  // 本项目实际用到的全部引用形式。**新增一种写法就必须同步这里**——下面有一条断言
  // 要求零未引用 key，漏一种形式就会把活 key 误报成死 key。
  const patterns = [
    // `\?` 覆盖可选调用 `translate?.(...)` —— 少了它会把 ai-models/options-refresh.js
    // 里两个**活的** key 误报成未引用。
    /(?:^|[^A-Za-z0-9_.])(?:t|translate|localize)(?:\?\.)?\(\s*["']([A-Za-z0-9_]+)["']/g,
    /\.\s*(?:t|translate|localize)(?:\?\.)?\(\s*["']([A-Za-z0-9_]+)["']/g,
    /getMessage\(\s*["']([A-Za-z0-9_]+)["']/g,
    /data-i18n(?:-title|-aria-label|-placeholder)?\s*=\s*["']([A-Za-z0-9_]+)["']/g,
    // 第五种：作为对象字段传递的 key（LANGUAGE_OPTIONS 的 labelKey、
    // native-only-policy 的 messageKey 等）。少了它会把 18 个**活的** key 误报成未引用。
    /(?:labelKey|messageKey|i18nKey|titleKey|fallbackKey)\s*:\s*["']([A-Za-z0-9_]+)["']/g,
    // 第六种：`someKey: cond ? "a" : "b"` 这种跨行三元（real-preload-recommendation.js）。
    // 两个分支都要收，所以是双捕获组 —— 上面的循环会遍历全部捕获组。
    /(?:labelKey|messageKey|i18nKey|titleKey|fallbackKey)\s*:[^"'`]{0,80}\?\s*["']([A-Za-z0-9_]+)["']\s*:\s*["']([A-Za-z0-9_]+)["']/g,
    // 把 key 单独放一行的调用（options-refresh.js 那种）由第一条的 `\s*` 覆盖，
    // 因为 JS 正则里 `\s` 也匹配换行。
    /__MSG_([A-Za-z0-9_]+)__/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      // 收全部捕获组：三元形式的模式一次给出两个分支的 key。
      for (const key of match.slice(1).filter(Boolean)) {
        if (!referenced.has(key)) {
          referenced.set(key, relativePath);
        }
      }
    }
  }
}

const unresolved = [...referenced]
  .filter(([key]) => !(key in baseMessages))
  .map(([key, where]) => `${key} (${where})`);

assert.deepEqual(unresolved, [], "代码引用了语言包里不存在的 key —— 运行时会渲染成空字符串");

const unreferenced = baseKeys.filter((key) => !referenced.has(key));

// 2026-08-02 起零死 key（368 → 291，删掉 77 × 10 = 770 条死翻译），所以这条从
// 「仅供参考」升级为**失败条件**：新增的 key 必须真的被用上，删功能时必须同步清语言包。
//
// 如果这里红了而你确信 key 是活的，八成是引用形式不在上面的模式列表里 —— 补模式，
// 别加白名单。本轮就靠这条抓出三类漏检：`translate?.(` 可选调用、`labelKey:` 对象字段、
// 以及 `messageKey: cond ? "a" : "b"` 跨行三元。
assert.deepEqual(
  unreferenced,
  [],
  "语言包里有代码从不引用的 key。要么删掉它，要么补上面 patterns 里缺的引用形式"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      locales: locales.length,
      keys: baseKeys.length,
      referencedKeys: referenced.size,
      // 列出来而不是只给个数字：数字变了没人知道是哪几个。
      unreferenced,
      unreferencedKeys: unreferenced.length,
    },
    null,
    2
  )
);
