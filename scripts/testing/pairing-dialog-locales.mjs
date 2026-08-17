// 配对弹窗的语言覆盖必须与扩展的 `_locales/` 一一对应。
//
// 弹窗文案在 Rust 侧（`app/src/api/pairing/text.rs`），扩展界面文案在
// `extension/_locales/`。**两边是各自独立维护的**——加一个语言时只改一边，
// 结果就是用户把界面切到新语言、配对弹窗却弹英文，而且没有任何报错。
//
// 为什么文案不能直接复用扩展的 `_locales`：配对确认的意义是「确认者不是请求者」。
// 如果弹窗文字由扩展传给 app，一个恶意扩展就能把「是否连接？」改写成别的问题。
// 所以只有**语言代号**来自请求方，文案本身必须是 app 自带的常量——重复是刻意的，
// 这个测试就是为重复的两份保持同步而存在。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pairingTextSource = readFileSync(
  path.join(repoRoot, "app/src/api/pairing/text.rs"),
  "utf8"
);

// --- 1. 两侧的语言集合必须相同 ---
{
  const extensionLocales = readdirSync(path.join(repoRoot, "extension/_locales"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.ok(extensionLocales.length >= 10, `扩展 locale 数量异常：${extensionLocales.length}`);

  const supportedBlock = pairingTextSource.match(
    /SUPPORTED_LOCALES:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/
  );
  assert.ok(supportedBlock, "没在 text.rs 里找到 SUPPORTED_LOCALES");

  const rustLocales = [...supportedBlock[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(
    rustLocales,
    extensionLocales,
    "配对弹窗支持的语言与 extension/_locales/ 不一致。" +
      "少的那一侧会让用户看到「界面是母语、弹窗是英文」，而且不报错"
  );
}

// --- 2. 每个语言都要有真正独立的文案常量，且 dialog_text 有对应分支 ---
{
  const supportedBlock = pairingTextSource.match(
    /SUPPORTED_LOCALES:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/
  );
  const rustLocales = [...supportedBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  // 两个弹窗各有一张分派表：配对确认、以及连续拒绝后的「不再提示」确认。
  // 任何一张漏一条分支，那个语言都会静默回落英文。
  const dispatchTables = [
    { label: "配对", fn: "dialog_text", prefix: "", fallback: /_\s*=>\s*&EN\b/ },
    {
      label: "不再提示",
      fn: "stop_asking_dialog_text",
      prefix: "STOP_ASKING_",
      fallback: /_\s*=>\s*&STOP_ASKING_EN\b/,
    },
  ];

  for (const table of dispatchTables) {
    const dispatchBlock = pairingTextSource.match(
      new RegExp(`fn ${table.fn}\\(locale: &str\\)[\\s\\S]*?\\n}`)
    );
    assert.ok(dispatchBlock, `没找到 ${table.fn} 的分派`);

    const missingBranch = rustLocales.filter((locale) => {
      // en 走 `_ =>` 兜底分支，其余每个都必须有自己的 match 臂。
      if (locale === "en") {
        return !table.fallback.test(dispatchBlock[0]);
      }
      return !new RegExp(`"${locale}"\\s*=>\\s*&${table.prefix}`).test(dispatchBlock[0]);
    });

    assert.deepEqual(
      missingBranch,
      [],
      `以下语言在 SUPPORTED_LOCALES 里，但 ${table.fn} 没有对应分支 —— 会静默回落英文（${table.label}弹窗）`
    );

    const missingConstant = rustLocales.filter(
      (locale) =>
        !new RegExp(
          `const ${table.prefix}${locale.toUpperCase()}: PairingDialogText`
        ).test(pairingTextSource)
    );
    assert.deepEqual(missingConstant, [], `以下语言缺${table.label}弹窗的文案常量`);
  }
}

// --- 3. 扩展发出的语言代号必须是 app 认得的形状 ---
//
// 扩展用 resolveLocaleId() 产出语言代号（值域 = SUPPORTED_LOCALE_IDS），
// app 用 normalize_locale() 接收。两边对不上的话弹窗会全线回落英文。
{
  const i18nConstants = readFileSync(
    path.join(repoRoot, "extension/shared/i18n/constants.js"),
    "utf8"
  );
  const modeBlock = i18nConstants.match(/LANGUAGE_MODE_VALUES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(modeBlock, "没找到 LANGUAGE_MODE_VALUES");

  const emittedLocales = [...modeBlock[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value !== "auto");

  const supportedBlock = pairingTextSource.match(
    /SUPPORTED_LOCALES:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/
  );
  const rustLocales = new Set(
    [...supportedBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  );

  const unrecognized = emittedLocales.filter((locale) => !rustLocales.has(locale));
  assert.deepEqual(
    unrecognized,
    [],
    "扩展能发出这些语言代号，但 app 的 SUPPORTED_LOCALES 里没有 —— 弹窗会回落英文"
  );
}

// --- 4. 语言头必须在 CORS 白名单里，否则预检会挡掉整个注册请求 ---
{
  const commonSource = readFileSync(
    path.join(repoRoot, "extension/background/shared/native-app/request/common.js"),
    "utf8"
  );
  const headerName = commonSource.match(
    /NATIVE_APP_EXTENSION_LOCALE_HEADER:\s*"([^"]+)"/
  )?.[1];
  assert.ok(headerName, "扩展侧没有定义语言请求头");

  const corsSource = readFileSync(path.join(repoRoot, "app/src/api/cors.rs"), "utf8");
  assert.ok(
    corsSource.includes(headerName.toLowerCase()),
    `${headerName} 不在 ACCESS_CONTROL_ALLOW_HEADERS 里 —— 预检会挡掉整个注册请求，` +
      "表现是本地 App 直接连不上，而不只是弹窗语言不对"
  );

  const apiSource = readFileSync(path.join(repoRoot, "app/src/api.rs"), "utf8");
  assert.ok(
    apiSource.includes(`"${headerName.toLowerCase()}"`),
    `app 侧的 EXTENSION_LOCALE_HEADER 与扩展发出的 ${headerName} 不一致`
  );
}

// --- 5. 语言模块必须在 service worker 打包清单里，且排在使用者之前 ---
{
  const manifestSource = readFileSync(
    path.join(repoRoot, "extension/service-worker-scripts.js"),
    "utf8"
  );
  const scripts = [...manifestSource.matchAll(/"([^"]+\.js)"/g)].map((match) => match[1]);

  const constantsIndex = scripts.indexOf("shared/i18n/constants.js");
  const localeIndex = scripts.indexOf("shared/i18n/locale.js");
  const consumerIndex = scripts.indexOf("background/shared/native-app/request/common.js");

  assert.ok(constantsIndex >= 0, "shared/i18n/constants.js 不在打包清单里");
  assert.ok(localeIndex >= 0, "shared/i18n/locale.js 不在打包清单里");
  assert.ok(consumerIndex >= 0, "找不到 native-app/request/common.js");

  assert.ok(
    constantsIndex < localeIndex,
    "locale.js 依赖 ZeroLatencyI18nConstants，必须排在 constants.js 之后"
  );
  assert.ok(
    localeIndex < consumerIndex,
    "common.js 要用 ZeroLatencyI18nLocale，必须排在 locale.js 之后"
  );
}

// --- 6. 语言记录不能被任意请求改写 ---
//
// 实测故障（2026-08-11）：托盘菜单是中文、配对弹窗却是英文。根因是
// `remember_ui_locale` 被放在注册判定**之前**无条件调用，于是：
//   - 不带语言头的旧版扩展（已发布版根本不发这个头）把「缺失」当成英文，
//     每 30 秒重试一次就把语言反复刷回英文；
//   - 连形状预筛都过不了、永远不会为它弹窗的 origin，照样能改掉托盘语言 ——
//     那是完全由调用方控制、却没有任何门槛的写入。
{
  const stateSource = readFileSync(path.join(repoRoot, "app/src/api/state.rs"), "utf8");
  const routeSource = readFileSync(
    path.join(repoRoot, "app/src/api/routes/extension.rs"),
    "utf8"
  );

  const rememberBody = stateSource.match(
    /pub\(crate\) fn remember_ui_locale\([\s\S]*?\n    \}/
  );
  assert.ok(rememberBody, "没找到 remember_ui_locale");
  assert.match(
    rememberBody[0],
    /requested_locale\.trim\(\)\.is_empty\(\)/,
    "remember_ui_locale 没有忽略空值 —— 没带语言头等于「没有意见」，不是「英文」；" +
      "把缺失当英文的话，一个旧版扩展每 30 秒就把语言刷回英文一次"
  );

  const decisionIndex = routeSource.indexOf("let decision = state");
  const rememberIndex = routeSource.indexOf("state.remember_ui_locale(");
  assert.ok(decisionIndex >= 0 && rememberIndex >= 0, "没找到判定或语言记录的调用点");
  assert.ok(
    rememberIndex > decisionIndex,
    "remember_ui_locale 在注册判定之前被调用 —— 被拒绝的注册尝试也能改掉托盘语言"
  );
  assert.match(
    routeSource.slice(decisionIndex, rememberIndex + 400),
    /!matches!\(decision, ExtensionRegistrationDecision::Rejected\)/,
    "语言记录没有跳过 Rejected —— 连形状预筛都没过的 origin 不该能写这个状态"
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "the pairing dialog covers exactly the extension's locales",
        "both dialogs (pairing and stop-asking) have a constant and dispatch arm per locale",
        "every locale the extension can emit is recognized by the app",
        "the locale header is allow-listed by CORS and named identically on both sides",
        "the i18n modules are bundled ahead of their consumer",
        "the remembered UI locale cannot be rewritten by rejected or header-less requests",
      ],
    },
    null,
    2
  )
);
