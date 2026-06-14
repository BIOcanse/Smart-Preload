# Manual Language And GitHub Release v1.0.11

Date: 2026-06-14

## User Requirements

- "app仅windows"
- "gtihub页面也提供多语言说明"
- "release只需要上传组合包，单拓展，单app三种即可"
- "没有语言切换功能，最好还是加上手动切换的功能（自动，以及各种语言的选择）然后release新版本"

## Target Behavior

The native app is released as a Windows-only package. GitHub release notes must make this clear and include multilingual setup guidance.

GitHub release assets are limited to:

1. `zero-latency-web-release-v1.0.11.zip`
2. `zero-latency-web-extension-v1.0.11.zip`
3. `zero-latency-web-app-windows-x64-v1.0.11.zip`

The local packaging script may still produce internal reviewer, Chrome Web Store, and test helper bundles for local use. Those helper bundles are not uploaded to the public GitHub release unless explicitly requested.

Extension UI language selection must support:

- `auto`
- `en`
- `zh_CN`
- `zh_TW`
- `ja`
- `ko`
- `de`
- `fr`
- `es`
- `pt_BR`
- `ru`

The manual language setting applies to extension-owned UI pages: settings page, popup, dynamic labels, statuses, and option labels. Chrome-managed manifest name/description and Chrome Web Store listing language are still controlled by browser/store locale handling.

## File Structure Plan

- `extansion/shared/i18n.js`
  - Owns supported language definitions.
  - Reads the selected UI language from extension settings.
  - Loads `_locales/<locale>/messages.json` asynchronously.
  - Keeps `t()` synchronous after initialization so existing UI rendering code stays simple.
- `extansion/shared/settings.js`
  - Adds `appearance.languageMode`.
  - Normalizes invalid language values back to `auto`.
  - Bumps the settings storage version.
- `extansion/settings/index.html`
  - Adds a language selector to the settings page.
- `extansion/settings/settings.js`
  - Populates the language selector.
  - Applies selected language immediately in the current settings page draft.
  - Persists the choice through the existing Save flow.
- `extansion/popup/popup.js`
  - Waits for i18n initialization before first render and snapshot status text.
- `extansion/_locales/*/messages.json`
  - Adds language-selector labels and descriptions in every supported locale.
- `docs/Release-Notes-v1.0.11.md`
  - Source Markdown release notes with clickable language sections powered by `<details><summary>`.
  - The same file can be used as the GitHub release body.
- `scripts/package-release.ps1`
  - Keeps package generation deterministic and updates release README wording for Windows-only app scope.

## Implementation Notes

`auto` resolves through `chrome.i18n.getUILanguage()` first, then `navigator.language`, then English. Non-exact browser locales map to the nearest supported language where possible: for example `zh-HK` maps to `zh_TW`, `pt-PT` maps to English because only Brazilian Portuguese is currently shipped.

Settings page startup must wait for `ZeroLatencyI18n.initialize()` before static `data-i18n` bindings and dynamic option lists are rendered. The popup follows the same pattern so first-load status text does not flash in the wrong language.

Changing the language selector updates the current page immediately, but persistence still follows the existing Save button semantics. Reset restores `auto`.

## Verification Plan

- Run focused settings normalization and i18n tests.
- Run existing app update catalog test because the release/version selector depends on GitHub asset naming.
- Run a Chrome-extension package check by executing the release package script.
- Verify the release output includes the three GitHub assets needed for upload.

## Follow-up Corrections

GitHub Release itself does not provide separate localized release-note fields. The source Markdown page can still provide click-to-switch language sections through GitHub-supported collapsed sections:

```html
<details name="release-language" open>
<summary><strong>English</strong></summary>
...
</details>
```

The `name` attribute is best-effort accordion behavior in browsers that support and preserve it. If GitHub strips the attribute, the page still works as clickable collapsed language sections. If a real dropdown, automatic locale detection, or styled tabs are needed later, build a small GitHub Pages documentation site and link the release page to that site.
