# 插件本地化 v0

## 范围

插件 UI 使用 Chrome 标准 `chrome.i18n` 体系。浏览器语言决定使用哪个消息文件：

- 英文：`extansion/_locales/en/messages.json`
- 简体中文：`extansion/_locales/zh_CN/messages.json`
- 兜底：英文，通过 `extansion/manifest.json` 中的 `default_locale: "en"` 指定

当前覆盖 manifest 名称/描述、popup UI、settings UI、settings 规则卡、AI provider/key 文本，以及展示给用户的运行反馈。

## 运行流程

1. `extansion/manifest.json` 使用 `__MSG_appName__` 和 `__MSG_appDescription__`。
2. HTML 页面先加载 `extansion/shared/i18n.js`，再加载页面自己的脚本。
3. `ZeroLatencyI18n.applyDocument(document)` 会替换带这些属性的元素：
   - `data-i18n`
   - `data-i18n-title`
   - `data-i18n-aria-label`
   - `data-i18n-placeholder`
4. JavaScript 动态文本使用 `ZeroLatencyI18n.t(key, substitutions, fallback)`。
5. `extansion/shared/settings.js` 加载时会按当前语言生成共享规则卡 schema。

## 消息规则

- 每个面向用户的字符串都必须在两个 locale 文件里有同名 key。
- 运行时变量使用 `{0}`、`{1}` 这种占位格式。
- 消息文件只放展示文本，不放业务逻辑。
- 英文是开发兜底；中文保持语义一致即可，不要求逐字直译。

## 新增 UI 文本

静态 HTML：

```html
<span data-i18n="settingsPreload">Preload</span>
```

动态 JavaScript：

```js
const label = ZeroLatencyI18n.t("popupWeightLabel", [score], `Weight: ${score}`);
```

共享 settings schema：

```js
title: localize("ruleNativeSiteTitle", "Native preload group high-weight site count x")
```

## 维护检查

发布前至少运行：

```powershell
node --check extansion\shared\i18n.js
node --check extansion\shared\settings.js
node --check extansion\popup\popup.js
node --check extansion\settings\settings.js
```

同时解析两个 message JSON 文件，避免尾逗号或括号错误。
