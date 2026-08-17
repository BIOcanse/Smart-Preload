// 设置页可访问性的静态不变量。
//
// 这些是「一旦回退就完全无声」的性质 —— 没有报错、没有视觉变化，只有键盘与读屏用户受影响，
// 所以必须由机器检查而不是靠人记住。
//
// H13 约 22 个开关的 checkbox 用 opacity: 0 藏在装饰性 .switch-track 后面，浏览器画在它上面的
//     默认焦点环完全不可见，而开关是这个页面的主要控件类型（WCAG 2.4.7）。
// H14 21/22 个开关 + 4 个 select 没有可访问名称。一个 <label for> 只命名它指向的**那一个**
//     控件；<label class="switch"> 里只有 checkbox 和装饰性 span，没有任何文本。
//     #scheduler-attention-pool-enabled 早就用对了 data-i18n-aria-label —— 模式存在只是没铺开。
// H15 967 行里零个 aria-live / role="status" / role="alert"。保存失败时页面显示「Failed」，
//     读屏用户什么都听不到，会以为保存成功就把页面关了。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const settingsHtml = readFileSync(path.join(repoRoot, "extension/settings/index.html"), "utf8");
const popupHtml = readFileSync(path.join(repoRoot, "extension/popup/hello.html"), "utf8");
const ruleControlsCss = readFileSync(
  path.join(repoRoot, "extension/settings/styles/rule-controls.css"),
  "utf8"
);
const ruleCardsJs = readFileSync(path.join(repoRoot, "extension/settings/rule-cards.js"), "utf8");
const localeMessages = JSON.parse(
  readFileSync(path.join(repoRoot, "extension/_locales/en/messages.json"), "utf8")
);

// --- H14a：每个开关都必须有可访问名称 ---
{
  const switchBlocks = [...settingsHtml.matchAll(/<label class="switch">([\s\S]*?)<\/label>/g)];
  assert.ok(switchBlocks.length >= 20, `开关数量异常：${switchBlocks.length}`);

  const unnamed = switchBlocks
    .map((match) => ({
      inner: match[1],
      id: match[1].match(/<input[^>]*id="([^"]+)"/)?.[1] ?? "(无 id)",
    }))
    .filter((entry) => !/aria-label/.test(entry.inner));

  assert.deepEqual(
    unnamed.map((entry) => entry.id),
    [],
    "以下开关没有可访问名称。<label class=\"switch\"> 里只有 checkbox 和装饰性 span，" +
      "不提供任何文本，读屏用户听到的是一串无名复选框"
  );
}

// --- H14b：所有表单控件都要能拿到名称 ---
{
  for (const [label, source] of [
    ["settings/index.html", settingsHtml],
    ["popup/hello.html", popupHtml],
  ]) {
    const labelledIds = new Set(
      [...source.matchAll(/<label\b[^>]*\bfor\s*=\s*"([^"]+)"/g)].map((match) => match[1])
    );
    const unnamed = [];

    for (const match of source.matchAll(/<(select|textarea|input)\b([^>]*)>/g)) {
      const rawAttrs = match[2];
      const type = rawAttrs.match(/\btype\s*=\s*"([^"]*)"/)?.[1]?.toLowerCase() ?? "";

      if (["hidden", "submit", "button", "reset"].includes(type)) {
        continue;
      }

      const id = rawAttrs.match(/\bid\s*=\s*"([^"]+)"/)?.[1] ?? "";
      const hasName =
        /\baria-label\s*=/.test(rawAttrs) ||
        /\bdata-i18n-aria-label\s*=/.test(rawAttrs) ||
        /\baria-labelledby\s*=/.test(rawAttrs) ||
        /\btitle\s*=/.test(rawAttrs) ||
        (id && labelledIds.has(id));

      if (!hasName) {
        unnamed.push(id || match[0].slice(0, 60));
      }
    }

    assert.deepEqual(unnamed, [], `${label} 里有控件缺可访问名称`);
  }
}

// --- H14c：aria-label 用到的 i18n key 必须存在 ---
{
  const ariaKeys = [
    ...new Set(
      [...settingsHtml.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((match) => match[1])
    ),
  ];
  assert.ok(ariaKeys.length >= 25, `aria-label key 数量异常：${ariaKeys.length}`);

  const missing = ariaKeys.filter((key) => !localeMessages[key]);
  assert.deepEqual(missing, [], "以下 aria-label 引用了不存在的 i18n key（会退化成空名称）");
}

// --- H14d：规则卡的 select 由 JS 生成，同样要有名称 ---
{
  const selectBlock = ruleCardsJs.slice(
    ruleCardsJs.indexOf('field.type === "select"'),
    ruleCardsJs.indexOf('field.type === "status-toggle"')
  );
  assert.ok(selectBlock.length > 0, "没找到规则卡 select 的构造分支");
  assert.match(
    selectBlock,
    /setAttribute\("aria-label"/,
    "规则卡的 select 没有 aria-label —— 外层 <label class=\"rule-slot\"> 只有 title 属性、" +
      "没有文本内容，读屏用户听到的是一串无名组合框"
  );
}

// --- H13：开关必须有可见的键盘焦点指示 ---
{
  assert.match(
    ruleControlsCss,
    /\.switch\s+input:focus-visible\s*\+\s*\.switch-track/,
    "开关没有 :focus-visible 焦点样式。真正的 checkbox 是 opacity: 0 的，" +
      "默认焦点环画在它上面完全不可见 —— 键盘用户无从知道焦点在哪"
  );
  // 用 :focus-visible 而不是 :focus —— 鼠标点击不该出现焦点环。
  assert.doesNotMatch(
    ruleControlsCss,
    /\.switch\s+input:focus\s*\+\s*\.switch-track/,
    "用了 :focus 而不是 :focus-visible，鼠标点击也会出现焦点环"
  );
}

// --- H15：状态变化必须进 live region ---
{
  for (const id of ["footer-status-title", "footer-status-text", "nav-status-text"]) {
    assert.ok(settingsHtml.includes(`id="${id}"`), `找不到状态节点 ${id}`);
  }

  const liveRegions = [...settingsHtml.matchAll(/aria-live="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(
    liveRegions.length >= 2,
    `live region 数量为 ${liveRegions.length} —— 保存结果只通过改写状态节点的文字表达，` +
      "没有 live region 时读屏用户听不到「保存失败」"
  );
  assert.ok(
    liveRegions.every((value) => value === "polite"),
    "live region 应当用 polite —— assertive 会打断用户正在听的内容"
  );

  // 页脚状态由标题 + 正文两个节点组成，必须整体播报而不是拆成两条互相打断的碎片。
  assert.match(
    settingsHtml,
    /class="settings-footer-copy"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
    "页脚状态区缺 role=status / aria-live / aria-atomic"
  );
}

// --- 威胁库状态：JS 加的语气类必须真的有对应样式 ---
//
// 这条是实机截图抓出来的：threat-library-status.js 会加 is-warning / is-error，
// 而 CSS 里当时唯一的 .is-warning 是 .settings-dialog.is-warning —— 另一个元素。
// 于是「快照已过去 54 天」和「加载失败」跟正常状态一个灰色，两条提示全部静默。
//
// 光查类名在 CSS 里出现过是查不出来的（.is-warning 确实出现过）。必须查
// **基础类 + 语气类的组合**：从 JS 取语气类、从 HTML 取该元素的基础类，再要求
// 样式表里存在同时命中两者的选择器。
{
  const statusJs = readFileSync(
    path.join(repoRoot, "extension/settings/threat-library-status.js"),
    "utf8"
  );
  const cssBundle = ["base-layout", "settings-items", "rule-controls", "dialogs", "status-actions-responsive"]
    .map((name) => readFileSync(path.join(repoRoot, `extension/settings/styles/${name}.css`), "utf8"))
    .join("\n");

  const toneClasses = [
    ...new Set(
      [...statusJs.matchAll(/classList\.add\(\s*"([^"]+)"/g)].map((match) => match[1])
    ),
  ];
  assert.ok(toneClasses.length >= 2, `没解析到语气类：${JSON.stringify(toneClasses)}`);

  const elementTag = settingsHtml.match(/<p\b[^>]*id="threat-library-status"[^>]*>/s);
  assert.ok(elementTag, "找不到 #threat-library-status");
  const baseClasses = (elementTag[0].match(/class="([^"]+)"/)?.[1] ?? "").split(/\s+/).filter(Boolean);
  assert.ok(baseClasses.length >= 1, "#threat-library-status 没有基础类，无法定位样式");

  const unstyled = toneClasses.filter((tone) => {
    return !baseClasses.some((base) => {
      // 两种书写顺序都算命中：.base.tone 或 .tone.base。
      const combined = new RegExp(`\\.(?:${base}\\.${tone}|${tone}\\.${base})(?![\\w-])`);
      return combined.test(cssBundle);
    });
  });

  assert.deepEqual(
    unstyled,
    [],
    `以下语气类加在 #threat-library-status（基础类 ${baseClasses.join(".")}）上却没有匹配的样式规则。` +
      "颜色不变 = 提示静默失效：过期的威胁库和加载失败的威胁库看起来跟正常的一模一样"
  );

  // 语气色必须是正文可读的色值，不能直接复用只做描边的浅色。
  for (const token of ["--warning-text", "--danger-text"]) {
    assert.ok(cssBundle.includes(`${token}:`), `缺少语气色变量 ${token}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "every switch has an accessible name",
        "every form control in settings and popup has an accessible name",
        "every aria-label i18n key exists",
        "JS-generated rule card selects carry an aria-label",
        "switches have a :focus-visible indicator (not :focus)",
        "status regions are polite live regions with atomic announcement",
        "threat library tone classes resolve to a real style rule",
      ],
    },
    null,
    2
  )
);
