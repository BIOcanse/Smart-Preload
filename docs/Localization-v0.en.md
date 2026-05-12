# Extension Localization v0

## Scope

The extension UI uses Chrome's standard `chrome.i18n` system. Browser language decides which message file is used:

- English: `extansion/_locales/en/messages.json`
- Simplified Chinese: `extansion/_locales/zh_CN/messages.json`
- Fallback: English, via `default_locale: "en"` in `extansion/manifest.json`

This covers the manifest name/description, popup UI, settings UI, settings rule cards, AI provider/key text, and runtime feedback shown to users.

## Runtime Flow

1. `extansion/manifest.json` uses `__MSG_appName__` and `__MSG_appDescription__`.
2. HTML pages load `extansion/shared/i18n.js` before page-specific scripts.
3. `ZeroLatencyI18n.applyDocument(document)` replaces elements marked with:
   - `data-i18n`
   - `data-i18n-title`
   - `data-i18n-aria-label`
   - `data-i18n-placeholder`
4. Dynamic JavaScript text uses `ZeroLatencyI18n.t(key, substitutions, fallback)`.
5. `extansion/shared/settings.js` localizes shared rule-card schemas when it is loaded.

## Message Rules

- Every user-visible string should have the same key in both locale files.
- Use `{0}`, `{1}` style placeholders for runtime values.
- Keep logic out of message files; message files only contain display text.
- English is the development fallback. Chinese should be kept semantically equivalent, not necessarily word-for-word.

## Adding UI Text

For static HTML:

```html
<span data-i18n="settingsPreload">Preload</span>
```

For dynamic JavaScript:

```js
const label = ZeroLatencyI18n.t("popupWeightLabel", [score], `Weight: ${score}`);
```

For shared settings schema:

```js
title: localize("ruleNativeSiteTitle", "Native preload group high-weight site count x")
```

## Maintenance Checks

Before packaging a release, run:

```powershell
node --check extansion\shared\i18n.js
node --check extansion\shared\settings.js
node --check extansion\popup\popup.js
node --check extansion\settings\settings.js
```

Also parse both message JSON files to catch trailing commas or missing braces.
